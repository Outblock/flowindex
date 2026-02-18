package repository

import (
	"context"
	"fmt"
	"time"
)

type MetricPoint struct {
	Time   time.Time
	Number string
}

// GetFeeMetricPoints returns fee aggregates bucketed by timescale between [from, to).
// Supported timescales: daily, hourly.
func (r *Repository) GetFeeMetricPoints(ctx context.Context, from, to time.Time, timescale string) ([]MetricPoint, error) {
	if !to.After(from) {
		return nil, fmt.Errorf("invalid time range: to must be after from")
	}

	var (
		bucketExpr string
		step       string
	)
	switch timescale {
	case "daily":
		bucketExpr = "date_trunc('day', l.timestamp)"
		step = "1 day"
	case "hourly":
		bucketExpr = "date_trunc('hour', l.timestamp)"
		step = "1 hour"
	default:
		return nil, fmt.Errorf("unsupported timescale: %s", timescale)
	}

	query := fmt.Sprintf(`
		WITH buckets AS (
			SELECT generate_series(
				date_trunc('%s', $1::timestamptz),
				date_trunc('%s', ($2::timestamptz - interval '1 second')),
				interval '%s'
			) AS bucket
		),
		fees AS (
			SELECT %s AS bucket, SUM(COALESCE(m.fee, 0))::numeric(78, 8) AS fee
			FROM app.tx_metrics m
			JOIN raw.tx_lookup l
			  ON l.id = m.transaction_id
			 AND l.block_height = m.block_height
			WHERE l.timestamp >= $1
			  AND l.timestamp < $2
			GROUP BY 1
		)
		SELECT b.bucket, COALESCE(f.fee, 0)::text AS number
		FROM buckets b
		LEFT JOIN fees f USING (bucket)
		ORDER BY b.bucket ASC
	`, timescaleToDateTrunc(timescale), timescaleToDateTrunc(timescale), step, bucketExpr)

	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]MetricPoint, 0, 64)
	for rows.Next() {
		var p MetricPoint
		if err := rows.Scan(&p.Time, &p.Number); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func timescaleToDateTrunc(timescale string) string {
	if timescale == "hourly" {
		return "hour"
	}
	return "day"
}
