/** Remove upstream vendor names and links from text rendered to customers. */
export function hideProviderBrand(text: string): string {
  return text
    .replace(/https?:\/\/\S*higgs[\s.-]*field(?:\.ai)?\S*/gi, 'модель')
    .replace(/higgs[\s.-]*field(?:\.ai)?/gi, 'модель')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
