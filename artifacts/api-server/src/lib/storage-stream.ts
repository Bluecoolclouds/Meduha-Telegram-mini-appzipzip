import type { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';

/**
 * Pipe a GCS stream to an HTTP response without destroying the GCS reader
 * before its upstream response has been initialized. The SDK may synchronously
 * throw from its response handler when its PassThrough is destroyed too early.
 */
export function pipeStorageReadStream(
  stream: Readable,
  response: ServerResponse,
  onError: (error: Error) => void,
): void {
  let clientDisconnected = false;
  let upstreamReady = false;
  let cancelScheduled = false;

  const cancelAfterSdkSetup = () => {
    if (!clientDisconnected || !upstreamReady || cancelScheduled) return;
    cancelScheduled = true;
    setImmediate(() => {
      if (clientDisconnected && !stream.destroyed) stream.destroy();
    });
  };

  stream.once('response', () => {
    upstreamReady = true;
    cancelAfterSdkSetup();
  });
  stream.once('error', error => {
    onError(error);
    if (!response.destroyed) response.destroy();
  });
  response.once('close', () => {
    if (response.writableFinished) return;
    clientDisconnected = true;
    if (!upstreamReady) {
      // A client can disconnect before pipe() triggers the SDK's lazy request.
      // Keep reading until the SDK has an upstream response, then cancel safely.
      stream.resume();
    } else {
      cancelAfterSdkSetup();
    }
  });
  stream.pipe(response);
}
