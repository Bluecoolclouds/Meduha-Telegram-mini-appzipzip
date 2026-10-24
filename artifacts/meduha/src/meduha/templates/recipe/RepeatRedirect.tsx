import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Frame } from '../../shared';
import RecipeBanner from './RecipeBanner';
import { useRecipeSource } from './useRecipeSource';
import { recipeHref } from './model';

/** Resolves /create?draft=repeat-… or a bare ?repeat=/?template= link into the exact model editor. */
export default function RepeatRedirect() {
  const [, navigate] = useLocation();
  const source = useRecipeSource();
  const view = source.view;
  useEffect(() => {
    if (view) navigate(recipeHref(view.recipe, source.own ? { repeat: view.id } : { template: source.templateId ?? undefined }), { replace: true });
  }, [view, source.own, source.templateId, navigate]);
  return <Frame active="Create"><div className="ps-page" data-testid="page-recipe-redirect"><RecipeBanner source={source.phase === 'ready' ? { ...source, phase: 'loading' } : source}/></div></Frame>;
}
