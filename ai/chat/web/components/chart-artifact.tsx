"use client";

import { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";
import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactContent,
} from "@/components/ai-elements/artifact";

Chart.register(...registerables);

export interface ChartData {
  chartType: "bar" | "line" | "pie" | "doughnut" | "horizontalBar";
  title: string;
  labels: string[];
  datasets: { label: string; data: number[] }[];
}

const COLORS = [
  "rgba(0, 239, 139, 0.8)",
  "rgba(59, 130, 246, 0.8)",
  "rgba(249, 115, 22, 0.8)",
  "rgba(168, 85, 247, 0.8)",
  "rgba(236, 72, 153, 0.8)",
  "rgba(234, 179, 8, 0.8)",
  "rgba(20, 184, 166, 0.8)",
  "rgba(239, 68, 68, 0.8)",
];

const BORDERS = COLORS.map((c) => c.replace("0.8)", "1)"));

export function ChartArtifact({ data }: { data: ChartData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Destroy previous chart instance
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const isHorizontal = data.chartType === "horizontalBar";
    const type = isHorizontal ? "bar" : data.chartType;
    const isPieish = data.chartType === "pie" || data.chartType === "doughnut";

    const datasets = data.datasets.map((ds, i) => ({
      label: ds.label,
      data: ds.data,
      backgroundColor: isPieish
        ? ds.data.map((_, j) => COLORS[j % COLORS.length])
        : COLORS[i % COLORS.length],
      borderColor: isPieish
        ? ds.data.map((_, j) => BORDERS[j % BORDERS.length])
        : BORDERS[i % BORDERS.length],
      borderWidth: 1,
    }));

    chartRef.current = new Chart(canvasRef.current, {
      type: type as any,
      data: { labels: data.labels, datasets },
      options: {
        indexAxis: isHorizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          title: { display: false },
          legend: {
            display: data.datasets.length > 1 || isPieish,
            labels: { color: "#94a3b8" },
          },
        },
        scales: isPieish
          ? undefined
          : {
              x: {
                ticks: { color: "#94a3b8", maxRotation: 45 },
                grid: { color: "rgba(255,255,255,0.06)" },
              },
              y: {
                ticks: { color: "#94a3b8" },
                grid: { color: "rgba(255,255,255,0.06)" },
              },
            },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data]);

  return (
    <Artifact className="overflow-visible">
      <ArtifactHeader>
        <ArtifactTitle>{data.title}</ArtifactTitle>
      </ArtifactHeader>
      <ArtifactContent className="overflow-visible bg-[#080808]">
        <canvas ref={canvasRef} />
      </ArtifactContent>
    </Artifact>
  );
}
