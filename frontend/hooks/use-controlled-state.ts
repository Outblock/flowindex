import * as React from 'react';

function useControlledState({
  default: defaultValue,
  value,
  onChange,
  defaultValue: _defaultValue,
}) {
  const [localValue, setLocalValue] = React.useState(
    _defaultValue || defaultValue
  );
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : localValue;

  const setValue = React.useCallback(
    (newValue) => {
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
