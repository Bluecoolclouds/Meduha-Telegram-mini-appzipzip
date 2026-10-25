type Configuration = {
  modelId?: string | null;
  enabled?: boolean;
  channelEnabled?: boolean;
  priceReady: boolean;
  pricingBlockedReason?: string | null;
};

// Configuration readiness only. Credential presence does not verify provider
// access; spending, account limits and the exact quote are checked separately.
export function catalogAvailabilityIssues(config: Configuration): string[] {
  const issues: string[] = [];
  if (config.pricingBlockedReason) issues.push(config.pricingBlockedReason);
  else if (!config.priceReady) issues.push('Цена режима ещё не настроена.');
  if (!config.modelId) issues.push('Модель ещё не настроена в студии.');
  else {
    if (!config.enabled) issues.push('Модель выключена администратором.');
    if (!config.channelEnabled) issues.push('Канал генерации выключен администратором.');
  }
  return issues;
}
