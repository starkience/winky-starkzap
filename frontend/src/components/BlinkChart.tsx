'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ChartDataPoint {
  time: number;
  blinks: number;
}

interface BlinkChartProps {
  data: ChartDataPoint[];
  height?: number;
}

export function BlinkChart({ data, height = 200 }: BlinkChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="blinkGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#C0B4DA" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#C0B4DA" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="time"
          stroke="#555"
          tick={{ fill: '#888', fontSize: 11 }}
          tickFormatter={(v) => `${Math.round(v)}s`}
        />
        <YAxis
          stroke="#555"
          tick={{ fill: '#888', fontSize: 11 }}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: '#A6A4A7',
            fontSize: '13px',
            fontFamily: "'Manrope', sans-serif",
          }}
          formatter={(value) => [`${value}`, 'Blinks']}
          labelFormatter={(label) => `${Number(label).toFixed(1)}s`}
        />
        <Area
          type="monotone"
          dataKey="blinks"
          stroke="#C0B4DA"
          strokeWidth={2}
          fill="url(#blinkGradient)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
