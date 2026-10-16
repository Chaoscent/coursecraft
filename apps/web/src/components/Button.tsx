// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  ToggleButton as AriaToggleButton,
  type ButtonProps,
} from 'react-aria-components';
import styles from './Button.module.css';
import { Icon } from './Icon.js';

interface Props extends Omit<ButtonProps, 'className' | 'children'> {
  variant?: 'default' | 'primary' | 'danger';
  icon?: string;
  children?: ReactNode;
}

export function Button({ variant = 'default', icon, children, ...rest }: Props) {
  return (
    <AriaButton {...rest} className={`${styles.button} ${styles[variant]}`}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </AriaButton>
  );
}

interface ToolProps extends Omit<ButtonProps, 'className' | 'children'> {
  icon: string;
  /** Visible label; for icon-only tools pass `aria-label` instead. */
  children?: ReactNode;
  large?: boolean;
}

/** Toolbar and ribbon button: icon with label, compact, borderless until hover. */
export function ToolButton({ icon, children, large, ...rest }: ToolProps) {
  return (
    <AriaButton
      {...rest}
      className={`${styles.tool} ${large ? styles.large : ''} ${children ? '' : styles.iconOnly}`}
    >
      <Icon name={icon} size={large ? 'lg' : 'md'} />
      {children}
    </AriaButton>
  );
}

export function ToggleTool({
  icon,
  children,
  isSelected,
  onChange,
  ...rest
}: {
  icon: string;
  children?: ReactNode;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
  'aria-label'?: string;
}) {
  return (
    <AriaToggleButton
      {...rest}
      isSelected={isSelected}
      onChange={onChange}
      className={`${styles.tool} ${children ? '' : styles.iconOnly}`}
    >
      <Icon name={icon} />
      {children}
    </AriaToggleButton>
  );
}
