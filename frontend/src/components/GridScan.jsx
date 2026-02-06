// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';

export default function GridScan({
    gridColor = "rgba(158, 255, 226, 0.1)", // Default to user's requested scan color roughly
    scanColor = "#9effe2",
    size = 40
}) {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none bg-black">
            {/* Grid Background */}
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: `linear-gradient(to right, ${gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`,
                    backgroundSize: `${size}px ${size}px`
                }}
            />

            {/* Scan Line */}
            <motion.div
                className="absolute w-full h-[50vh] bg-gradient-to-b from-transparent to-current opacity-20"
                style={{ color: scanColor }}
                initial={{ top: '-50%' }}
                animate={{ top: '100%' }}
                transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "linear"
                }}
            />

            {/* Glow at the bottom of the scan line */}
            <motion.div
                className="absolute w-full h-1 blur-md"
                style={{ backgroundColor: scanColor }}
                initial={{ top: '0%' }}
                animate={{ top: '100%' }}
                transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "linear"
                }}
            />

            {/* Radial Vignette */}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black opacity-80" />
        </div>
    );
}
