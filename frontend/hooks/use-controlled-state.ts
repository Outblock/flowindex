import * as React from 'react';

interface UseControlledStateParams<T> {
  default?: T;
  defaultValue?: T;
  value?: T;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange?: (value: T, ...args: any[]) => void;
}

function useControlledState<T>({
  default: defaultProp,
  defaultValue,
  value,
  onChange,
}: UseControlledStateParams<T>): [T | undefined, (newValue: T) => void] {
  const [localValue, setLocalValue] = React.useState<T | undefined>(
    defaultValue || defaultProp
  );
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : localValue;

  const setValue = React.useCallback(
    (newValue: T) => {
      if (!isControlled) {
        setLocalValue(newValue);
      }
      onChange?.(newValue);
    },
    [isControlled, onChange]
  );

  return [currentValue, setValue];
}

export { useControlledState };
