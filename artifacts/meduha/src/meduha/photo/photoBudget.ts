export function exceedsModelDailyBudget(creditPrice: number, modelDailyRemaining: number | null): boolean {
  return modelDailyRemaining !== null && creditPrice > modelDailyRemaining;
}
