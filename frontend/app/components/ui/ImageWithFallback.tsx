import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ImageWithFallbackProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    fallback?: React.ReactNode;
}

export function ImageWithFallback({
    src,
    alt,
    className,
    fallback,
    ...props
}: ImageWithFallbackProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);

    const handleLoad = () => {
        setIsLoading(false);
    };

    const handleError = () => {
        setIsLoading(false);
        setError(true);
    };

    const hasSrc = src && src !== '' && src !== 'null' && src !== 'undefined';

    if (error || !hasSrc) {
        return (
            <div className={cn("flex items-center justify-center bg-zinc-100 dark:bg-white/5 text-zinc-300 dark:text-zinc-700", className)}>
                {fallback || <ImageIcon className="w-1/3 h-1/3" />}
            </div>
        );
    }

    return (
        <div className={cn("relative overflow-hidden bg-zinc-100 dark:bg-white/5", className)}>
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 dark:bg-white/5 animate-pulse z-10">
                    <ImageIcon className="w-1/3 h-1/3 text-zinc-300 dark:text-zinc-700 opacity-50" />
                </div>
            )}
            <img
                src={src}
                alt={alt}
                onLoad={handleLoad}
                onError={handleError}
                className={cn("w-full h-full object-cover transition-opacity duration-300", isLoading ? "opacity-0" : "opacity-100")}
                {...props}
            />
        </div>
    );
}
