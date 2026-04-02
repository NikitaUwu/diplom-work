import unittest

from app.schemas.ml import Panel
from app.services.chart_editor import build_editor_result_json
from app.services.cubic_selection import select_cubic_spline_points
from app.services.spline import sample_cubic_spline


class ChartEditorTests(unittest.TestCase):
    def test_select_cubic_spline_points_keeps_boundaries_and_picks_peak(self):
        points = [(0, 0), (1, 0), (2, 5), (3, 0), (4, 0)]

        selected = select_cubic_spline_points(points, total_points=3)

        self.assertEqual(selected, [(0.0, 0.0), (2.0, 5.0), (4.0, 0.0)])

    def test_sample_cubic_spline_returns_sorted_points_for_short_series(self):
        self.assertEqual(sample_cubic_spline([(2, 5), (1, 3)], samples=10), [[1.0, 3.0], [2.0, 5.0]])

    def test_build_editor_result_json_replaces_legacy_interp_with_cubic_spline_preview(self):
        payload = {
            'artifacts': {'converted_plot': 'plot.png'},
            'panels': [
                {
                    'id': 'panel-1',
                    'series': [
                        {
                            'id': 'series-1',
                            'name': 'Series 1',
                            'interp': 'lsq',
                            'points': [[0, 0], [1, 1], [2, 0]],
                        }
                    ],
                }
            ],
        }

        panels = [Panel.model_validate(payload['panels'][0])]
        result = build_editor_result_json(payload, panels)

        series = result['panels'][0]['series'][0]
        self.assertEqual(result['artifacts'], payload['artifacts'])
        self.assertEqual(series['approximation_method'], 'cubic_spline')
        self.assertNotIn('interp', series)
        self.assertEqual(series['points'], [[0.0, 0.0], [1.0, 1.0], [2.0, 0.0]])
        self.assertEqual(len(series['curve_points']), 301)
        self.assertEqual(series['curve_points'][0], [0.0, 0.0])
        self.assertEqual(series['curve_points'][-1], [2.0, 0.0])

    def test_build_editor_result_json_can_reduce_series_points_before_preview(self):
        payload = {
            'panels': [
                {
                    'id': 'panel-1',
                    'series': [
                        {
                            'id': 'series-1',
                            'name': 'Series 1',
                            'points': [[0, 0], [1, 0], [2, 5], [3, 0], [4, 0]],
                        }
                    ],
                }
            ],
        }

        panels = [Panel.model_validate(payload['panels'][0])]
        result = build_editor_result_json(
            payload,
            panels,
            point_transform=lambda points: select_cubic_spline_points(points, total_points=3),
        )

        series = result['panels'][0]['series'][0]
        self.assertEqual(series['points'], [[0.0, 0.0], [2.0, 5.0], [4.0, 0.0]])
        self.assertEqual(series['curve_points'][0], [0.0, 0.0])
        self.assertEqual(series['curve_points'][-1], [4.0, 0.0])


if __name__ == '__main__':
    unittest.main()