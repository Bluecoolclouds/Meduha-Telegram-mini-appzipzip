import type { RecipeView } from '../templates/recipe/model';
import { fileKindOf } from '../templates/recipe/model';
import { splitPath, type FileField, type Ref } from './videoSchema';

export type VideoDraft = { params: Record<string, unknown>; json: Record<string, string>; refs: Record<string, Ref[]>; items: Record<string, string[]>; pending?: { fp: string; key: string } };

/** Turn a recipe into the editor's local state once; later edits live only in local storage. */
export function hydrateVideo(view: RecipeView, fileFields: FileField[], jsonKeys: Set<string>, parents: string[]): VideoDraft {
  const out: VideoDraft = { params: {}, json: {}, refs: {}, items: {} };
  for (const [k, v] of Object.entries(view.recipe.parameters)) {
    if (parents.includes(k) && Array.isArray(v)) out.items[k] = v.map(x => JSON.stringify(x, null, 2));
    else if (jsonKeys.has(k)) out.json[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    else out.params[k] = v;
  }
  for (const [ptr, ids] of Object.entries(view.recipe.references)) {
    const direct = fileFields.find(f => f.path === ptr);
    const m = ptr.match(/^\/([^/]+)\/\d+(\/.*)$/);
    const nested = m ? fileFields.find(f => { const s = splitPath(f.path); return s.root === m[1] && s.sub === m[2]; }) : undefined;
    const files = view.files[ptr] ?? [];
    out.refs[ptr] = ids.map((id, i) => {
      const meta = files.find(f => f.id === id) ?? files[i];
      return { id, name: `${ptr.replace(/^\//, '')} ${i + 1}`, kind: (direct ?? nested)?.kind ?? (meta ? fileKindOf(meta.contentType) : 'image') };
    });
  }
  return out;
}
