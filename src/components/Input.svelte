<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  /** Alineado con shadcn/ui Input (Radix): borde, altura, focus y estados. */
  type Props = Omit<HTMLInputAttributes, 'class' | 'value'> & {
    class?: string
    value?: HTMLInputAttributes['value']
  }

  let {
    class: className = '',
    value = $bindable(),
    ...rest
  }: Props = $props()

  const classes = $derived(['shadcn-input', className].filter(Boolean).join(' '))
</script>

<input class={classes} {...rest} bind:value />

<style>
  .shadcn-input {
    display: flex;
    width: 100%;
    min-width: 0;
    height: 2.25rem;
    box-sizing: border-box;
    border-radius: 0.375rem;
    border: 1px solid #e4e4e7;
    background: #fff;
    padding: 0.25rem 0.75rem;
    font-size: 0.875rem;
    line-height: 1.25;
    font-family: inherit;
    color: #18181b;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      background-color 0.15s ease,
      opacity 0.15s ease;
  }

  @media (min-width: 768px) {
    .shadcn-input {
      font-size: 0.875rem;
    }
  }

  .shadcn-input::placeholder {
    color: #71717a;
  }

  .shadcn-input:focus-visible {
    outline: 2px solid #18181b;
    outline-offset: 2px;
  }

  .shadcn-input:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .shadcn-input[aria-invalid='true'] {
    border-color: #dc2626;
  }
  .shadcn-input[aria-invalid='true']:focus-visible {
    outline-color: #dc2626;
  }

  /* type="file" (equivalente a clases file:* de shadcn) */
  .shadcn-input[type='file'] {
    padding-top: 0.125rem;
    padding-bottom: 0.125rem;
  }

  .shadcn-input::file-selector-button {
    margin-inline-end: 0.5rem;
    border: 0;
    background: transparent;
    padding: 0;
    font-size: 0.875rem;
    font-weight: 500;
    font-family: inherit;
    color: #18181b;
    cursor: pointer;
  }

  .shadcn-input:disabled::file-selector-button {
    cursor: not-allowed;
  }
</style>
