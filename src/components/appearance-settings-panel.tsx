import { useId } from 'react';
import { ArrowLeft, Check, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ColorScheme, LayoutPrefsState } from '@/hooks/use-layout-prefs';
import { defaultThemeId, themes } from '@/lib/themes';
import { cn } from '@/lib/utils';

function ThemePreview({ surface, accent }: { surface: string; accent: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full overflow-hidden rounded-lg border"
      style={{ background: surface, borderColor: `color-mix(in srgb, ${accent} 18%, ${surface})` }}
    >
      <div
        className="flex w-[27%] shrink-0 flex-col gap-2 border-r p-2.5"
        style={{
          background: `color-mix(in srgb, ${accent} 5%, ${surface})`,
          borderColor: `color-mix(in srgb, ${accent} 12%, ${surface})`,
        }}
      >
        <span className="mb-1 h-1 w-3 rounded-full" style={{ background: accent, opacity: 0.6 }} />
        <span className="h-1 w-full rounded-full" style={{ background: accent, opacity: 0.3 }} />
        <span className="h-1 w-4/5 rounded-full" style={{ background: accent, opacity: 0.15 }} />
        <span className="h-1 w-3/5 rounded-full" style={{ background: accent, opacity: 0.15 }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
        <span className="h-1 w-1/2 rounded-full" style={{ background: accent, opacity: 0.5 }} />
        <div className="mt-1 flex flex-col gap-1.5">
          <span className="h-1 w-full rounded-full" style={{ background: accent, opacity: 0.15 }} />
          <span className="h-1 w-4/5 rounded-full" style={{ background: accent, opacity: 0.15 }} />
        </div>
        <div className="mt-auto flex items-center justify-end">
          <span className="h-2.5 w-8 rounded-full" style={{ background: accent }} />
        </div>
      </div>
    </div>
  );
}

const modes: { id: ColorScheme; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

export function AppearanceSettingsPanel({ layout, onBack }: { layout: LayoutPrefsState; onBack: () => void }) {
  const titleId = useId();
  const visualStyleId = useId();
  const themeId = useId();
  const { colorScheme, setColorScheme, theme, setTheme } = layout;
  const currentTheme = themes.find((option) => option.id === theme) ?? themes[0];

  return (
    <section
      aria-labelledby={titleId}
      className="app-region-no-drag min-h-0 min-w-0 flex-1 overflow-y-auto bg-background px-6 py-10 text-foreground sm:px-10 sm:py-14 lg:px-16"
    >
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10">
          <Button variant="ghost" size="sm" className="-ml-2 mb-5 gap-1.5 text-muted-foreground" onClick={onBack}>
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to workspace
          </Button>
          <h1 id={titleId} className="text-[28px] font-semibold tracking-tight">
            Appearance
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose the mode and colors for your workspace.</p>
        </header>

        <section aria-labelledby={visualStyleId}>
          <h2 id={visualStyleId} className="mb-3 text-sm font-medium">
            Visual style
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-border bg-card p-5">
            <div>
              <p className="text-sm font-medium">Mode</p>
              <p className="mt-1 text-xs text-muted-foreground">Light or dark, your choice.</p>
            </div>
            <div role="group" aria-label="Appearance mode" className="flex gap-3">
              {modes.map((mode) => {
                const active = mode.id === colorScheme;
                const [surface, accent] = currentTheme.preview[mode.id];
                const Icon = mode.icon;

                return (
                  <button
                    key={mode.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setColorScheme(mode.id)}
                    className={cn(
                      'w-28 rounded-xl border p-1.5 text-sm transition-colors outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-32',
                      active ? 'border-ring bg-accent ring-1 ring-ring' : 'border-border bg-background',
                    )}
                  >
                    <div className="h-[72px]">
                      <ThemePreview surface={surface} accent={accent} />
                    </div>
                    <span className="flex items-center justify-center gap-1.5 py-2 font-medium">
                      <Icon className="size-3.5" />
                      {mode.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section aria-labelledby={themeId} className="mt-8">
          <h2 id={themeId} className="text-sm font-medium">
            Color theme
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">A palette for every part of your workspace.</p>
          <div role="group" aria-label="Color theme" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {themes.map((option) => {
              const active = option.id === theme;
              const [surface, accent] = option.preview[colorScheme];

              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  title={option.description}
                  onClick={() => setTheme(option.id)}
                  className={cn(
                    'min-w-0 rounded-xl border p-2 text-left transition-colors outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    active ? 'border-ring bg-accent ring-1 ring-ring' : 'border-border bg-card',
                  )}
                >
                  <div className="h-24 sm:h-28">
                    <ThemePreview surface={surface} accent={accent} />
                  </div>
                  <span className="flex items-center gap-2 px-1 py-2.5">
                    <span className="size-3 shrink-0 rounded-full border border-border" style={{ background: accent }} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span>
                    {active ? <Check className="size-4 shrink-0" /> : <span className="size-4" />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="mt-8 flex justify-end">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            disabled={theme === defaultThemeId}
            aria-label="Reset color theme to default"
            onClick={() => setTheme(defaultThemeId)}
          >
            Reset to default
          </Button>
        </div>
      </div>
    </section>
  );
}
