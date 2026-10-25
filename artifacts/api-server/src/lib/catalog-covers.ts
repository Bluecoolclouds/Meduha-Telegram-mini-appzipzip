import manifest from '../../../meduha/src/meduha/cover-media.json';

type CoverAsset = { id: string; size: number; width: number; height: number; contentType: string };
const assets: Record<string, CoverAsset> = manifest.assets;

/** Public, curated examples only. Requests cannot supply paths or upstream URLs. */
export function catalogCoverAsset(name: string): CoverAsset | undefined {
  return Object.hasOwn(assets, name) ? assets[name] : undefined;
}
