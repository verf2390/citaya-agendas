export function hasOnboardingCompleted(tenant: {
  name?: string | null;
  onboarding_completed_at?: string | null;
}) {
  return Boolean(tenant?.onboarding_completed_at || tenant?.name?.trim());
}
