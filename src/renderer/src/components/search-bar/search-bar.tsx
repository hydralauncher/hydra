import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from '@primer/octicons-react';
import classNames from 'classnames';
import './search-bar.scss';

interface SearchBarProps {
    onSearch: (query: string) => void;
    placeholder?: string;
    initialValue?: string;
    className?: string;
    autoFocus?: boolean;
    clearable?: boolean;
}

export function SearchBar({
    onSearch,
    placeholder,
    initialValue = '',
    className,
    autoFocus = false,
    clearable = true,
}: SearchBarProps) {
    const { t } = useTranslation();
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setValue(newValue);
        onSearch(newValue);
    };

    const handleClear = () => {
        setValue('');
        onSearch('');
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    return (
        <div className={classNames('search-bar', className)}>
            <Search className="search-bar__icon" />
            <input
                ref={inputRef}
                type="text"
                className="search-bar__input"
                value={value}
                onChange={handleChange}
                placeholder={placeholder || t('search')}
            />
            {clearable && value && (
                <button className="search-bar__clear-button" onClick={handleClear}>
                    ×
                </button>
            )}
        </div>
    );
} 