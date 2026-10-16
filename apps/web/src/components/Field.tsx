// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import {
  Checkbox as AriaCheckbox,
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  Button as AriaButton,
  TextArea,
  TextField as AriaTextField,
  Text,
  type Key,
} from 'react-aria-components';
import styles from './Field.module.css';
import { Icon } from './Icon.js';

/** Label-left form layout. */
export function FormGrid({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`${styles.grid} ${wide ? styles.wide : ''}`}>{children}</div>;
}

interface TextProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'search';
  autoComplete?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  autoFocus?: boolean;
  description?: string;
  errorMessage?: string | undefined;
  minLength?: number;
  multiline?: boolean;
  name?: string;
}

export function TextField({ label, description, errorMessage, multiline, ...props }: TextProps) {
  return (
    <AriaTextField {...props} className={styles.field} isInvalid={!!errorMessage} validationBehavior="aria">
      <Label className={styles.label}>{label}</Label>
      <div className={styles.control}>
        {multiline ? <TextArea className={styles.textarea} /> : <Input className={styles.input} />}
        {description ? (
          <Text slot="description" className={styles.description}>
            {description}
          </Text>
        ) : null}
        <FieldError className={styles.error}>{errorMessage}</FieldError>
      </div>
    </AriaTextField>
  );
}

interface SelectProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { id: T; label: string }[];
  isDisabled?: boolean;
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  isDisabled,
}: SelectProps<T>) {
  return (
    <Select
      className={styles.field}
      selectedKey={value}
      onSelectionChange={(key: Key | null) => {
        if (key !== null) onChange(String(key) as T);
      }}
      isDisabled={isDisabled ?? false}
    >
      <Label className={styles.label}>{label}</Label>
      <div className={styles.control}>
        <AriaButton className={styles.select}>
          <SelectValue />
          <Icon name="chevron-down" />
        </AriaButton>
      </div>
      <Popover className={styles.popover}>
        <ListBox className={styles.listbox}>
          {options.map((o) => (
            <ListBoxItem key={o.id} id={o.id} className={styles.option}>
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}

export function Checkbox({
  children,
  isSelected,
  onChange,
  isDisabled,
}: {
  children: ReactNode;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
  isDisabled?: boolean;
}) {
  return (
    <AriaCheckbox
      className={styles.checkbox}
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled ?? false}
    >
      <span className={styles.box} aria-hidden="true">
        <Icon name="check" />
      </span>
      {children}
    </AriaCheckbox>
  );
}

/** Row in a FormGrid whose control is arbitrary content (checkbox groups, buttons). */
export function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.control}>{children}</div>
    </div>
  );
}
