<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import type { Snippet } from 'svelte'
  import type { IconProps } from 'lucide-svelte'

  /** Alineado con la API de shadcn/ui Button (variantes y tamaños). */
  export type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
  export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg'

  /** Icono Lucide (`lucide-svelte/icons/*`). Tipado `any`: los iconos declaran clase Svelte 3 y no encajan con `Component` de Svelte 5. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type LucideIcon = any

  type Props = Omit<HTMLButtonAttributes, 'type' | 'class'> & {
    variant?: ButtonVariant
    size?: ButtonSize
    type?: HTMLButtonElement['type']
    class?: string
    children?: Snippet
    /** Icono de [Lucide](https://lucide.dev/icons/) (lucide-svelte). */
    icon?: LucideIcon | null
    /** Posición respecto al texto (equivalente a `data-icon` inline-start / inline-end). */
    iconPosition?: 'start' | 'end'
    /** Props extra para el SVG de Lucide (p. ej. `strokeWidth`, `class`). */
    iconProps?: Partial<IconProps>
  }

  let {
    variant = 'default',
    size = 'default',
    type = 'button',
    class: className = '',
    children,
    icon = null,
    iconPosition = 'start',
    iconProps = {},
    ...rest
  }: Props = $props()

  const Icon = $derived(icon)

  const lucideSize = $derived.by(() => {
    switch (size) {
      case 'sm':
      case 'icon-sm':
        return 14
      case 'lg':
      case 'icon-lg':
        return 20
      case 'icon':
        return 16
      default:
        return 16
    }
  })

  const iconSpread = $derived({
    ...iconProps,
    size: iconProps.size ?? lucideSize,
    class: ['shadcn-btn__icon', iconProps.class].filter(Boolean).join(' ')
  })

  const classes = $derived(
    ['shadcn-btn', `shadcn-btn--${variant}`, `shadcn-btn--size-${size}`, className].filter(Boolean).join(' ')
  )
</script>

<button {type} class={classes} {...rest}>
  {#if Icon && iconPosition === 'start'}
    <Icon {...iconSpread} data-icon="inline-start" />
  {/if}
  {@render children?.()}
  {#if Icon && iconPosition === 'end'}
    <Icon {...iconSpread} data-icon="inline-end" />
  {/if}
</button>

<style>
  .shadcn-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    white-space: nowrap;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25;
    font-family: inherit;
    border: 1px solid transparent;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      opacity 0.15s ease;
    box-sizing: border-box;
  }

  .shadcn-btn:focus-visible {
    outline: 2px solid #18181b;
    outline-offset: 2px;
  }

  .shadcn-btn:disabled {
    pointer-events: none;
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Icon spacing (como en shadcn: data-icon="inline-start" | "inline-end") */
  .shadcn-btn :global([data-icon='inline-start']) {
    margin-inline-end: 0.125rem;
  }
  .shadcn-btn :global([data-icon='inline-end']) {
    margin-inline-start: 0.125rem;
  }

  .shadcn-btn :global(.shadcn-btn__icon) {
    flex-shrink: 0;
    pointer-events: none;
  }

  /* Sizes */
  .shadcn-btn--size-default {
    height: 2.25rem;
    padding: 0 1rem;
  }
  .shadcn-btn--size-sm {
    height: 2rem;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
    border-radius: 0.375rem;
  }
  .shadcn-btn--size-lg {
    height: 2.5rem;
    padding: 0 2rem;
    font-size: 0.875rem;
    border-radius: 0.375rem;
  }
  .shadcn-btn--size-icon {
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
  }
  .shadcn-btn--size-icon-sm {
    width: 2rem;
    height: 2rem;
    padding: 0;
  }
  .shadcn-btn--size-icon-lg {
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
  }

  /* Variants (tema claro tipo zinc / shadcn) */
  .shadcn-btn--default {
    background: #18181b;
    color: #fafafa;
    border-color: #18181b;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  }
  .shadcn-btn--default:hover:not(:disabled) {
    background: #27272a;
    border-color: #27272a;
  }

  .shadcn-btn--secondary {
    background: #f4f4f5;
    color: #18181b;
    border-color: #e4e4e7;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
  }
  .shadcn-btn--secondary:hover:not(:disabled) {
    background: #e4e4e7;
  }

  .shadcn-btn--outline {
    background: #fff;
    color: #18181b;
    border-color: #e4e4e7;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
  }
  .shadcn-btn--outline:hover:not(:disabled) {
    background: #f4f4f5;
    color: #18181b;
  }

  .shadcn-btn--ghost {
    background: transparent;
    color: #18181b;
    border-color: transparent;
    box-shadow: none;
  }
  .shadcn-btn--ghost:hover:not(:disabled) {
    background: #f4f4f5;
  }

  .shadcn-btn--destructive {
    background: #dc2626;
    color: #fef2f2;
    border-color: #dc2626;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
  }
  .shadcn-btn--destructive:hover:not(:disabled) {
    background: #b91c1c;
    border-color: #b91c1c;
  }

  .shadcn-btn--link {
    background: transparent;
    color: #18181b;
    border-color: transparent;
    box-shadow: none;
    text-underline-offset: 4px;
    height: auto;
    padding: 0 0.25rem;
  }
  .shadcn-btn--link:hover:not(:disabled) {
    text-decoration: underline;
  }
</style>
