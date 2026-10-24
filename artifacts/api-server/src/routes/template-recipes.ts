import { Router } from 'express';
import { CreateTemplateRecipeDraftBody, RepeatTemplateBody, GetTemplateRecipeResponse as TemplateRecipeView } from '@workspace/api-zod';
import { currentAccount, requireAccount } from './meduha';
import { RecipeError, sourceRecipe, savedRecipe, saveRecipeDraft, repeatRecipe } from '../lib/template-recipes';

export function createTemplateRecipeRouter(copy?: Parameters<typeof repeatRecipe>[3], remove?: Parameters<typeof repeatRecipe>[4]) {
  const router = Router();
  const failure = (e: unknown, res: import('express').Response) => {
    if (e instanceof RecipeError) res.status(e.status).json({ error: e.message });
    else throw e;
  };
  router.get('/template-recipes/:id', async (req, res) => {
    try {
      const account = await currentAccount(req);
      res.set('Cache-Control', 'no-store').json(TemplateRecipeView.parse(await sourceRecipe(String(req.params.id), account?.id)));
    } catch (e) { failure(e, res); }
  });
  router.post('/templates/:id/repeat', async (req, res) => {
    const account = await requireAccount(req, res); if (!account) return;
    const body = RepeatTemplateBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Неверный запрос повторения.' }); return; }
    try {
      res.status(201).json(TemplateRecipeView.parse(await repeatRecipe(String(req.params.id), body.data.requestId, account.id, copy, remove)));
    } catch (e) { failure(e, res); }
  });
  router.get('/template-repeats/:id', async (req, res) => {
    const account = await requireAccount(req, res); if (!account) return;
    try {
      res.set('Cache-Control', 'no-store').json(TemplateRecipeView.parse(await savedRecipe(String(req.params.id), account.id)));
    } catch (e) { failure(e, res); }
  });
  router.post('/template-recipe-drafts', async (req, res) => {
    const account = await requireAccount(req, res); if (!account) return;
    const body = CreateTemplateRecipeDraftBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Проверь название и параметры шаблона.' }); return; }
    try {
      res.status(201).json(TemplateRecipeView.parse(await saveRecipeDraft(body.data.title, body.data.recipe, account.id)));
    } catch (e) { failure(e, res); }
  });
  return router;
}
export default createTemplateRecipeRouter();
