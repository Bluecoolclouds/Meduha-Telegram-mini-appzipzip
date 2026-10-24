# Restore the Genjutsu community example after copying this project

Each Repl has its own App Storage bucket. After copying the project, seed the five approved objects into the new bucket; this does not copy them from the original Repl.

1. Make sure App Storage is enabled for the copied Repl and that its `PRIVATE_OBJECT_DIR` setting is configured.
2. Add the four approved originals to `attached_assets/` in the copied Repl, named `motion-result.mp4`, `motion-reference.mp4`, `motion-image-1.webp`, and `motion-image-2.webp`. The source files are not committed to Git. The script also recognizes the original uploaded filenames when they are present.
3. Run this command from the project root:

   ```sh
   pnpm --filter @workspace/scripts run seed:motion-example
   ```

The small JPEG poster is included with the seed script. The script checks the exact approved SHA-256 and size for all five local files before writing anything, then uploads them to their stable object IDs with their declared MIME types. It verifies stored checksums. If one of these reserved sample IDs already contains different bytes, the script refreshes only that object using a generation check so concurrent changes are not overwritten. Re-running it with the same inputs is safe. To use a different local folder for the four originals, set `MOTION_EXAMPLE_MEDIA_DIR` to that folder before running the command.

After seeding, the public routed URLs are:

- `/api/meduha/example-media/motion-poster.jpg`
- `/api/meduha/example-media/motion-result.mp4`
- `/api/meduha/example-media/motion-reference.mp4`
- `/api/meduha/example-media/motion-image-1.webp`
- `/api/meduha/example-media/motion-image-2.webp`
