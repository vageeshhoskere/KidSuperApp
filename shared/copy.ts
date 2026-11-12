export const COPY = {
  oops: "Oops, let's try again!",
  pii: "Let's keep things like addresses secret!",
  redirect: "Let's build something else! How about a {idea}?",
  held: "A grown-up will check this one!",
  closed: "The building shop is closed — come back tomorrow!",
  setup: "Ask a grown-up to set me up!",
  here: "Here's your {title}!",
  tooLong: "That's a lot of words! Can you say it shorter?",
  busy: "Still building, one moment!",
} as const;

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}
