import importlib
import os
import unittest


class ConfigTests(unittest.TestCase):
    def test_vanna_base_url_defaults_to_local_port(self):
        old_port = os.environ.get("PORT")
        old_vanna = os.environ.get("VANNA_BASE_URL")
        try:
            os.environ["PORT"] = "9999"
            os.environ.pop("VANNA_BASE_URL", None)
            import config

            reloaded = importlib.reload(config)
            self.assertEqual(reloaded.VANNA_BASE_URL, "http://127.0.0.1:9999")
        finally:
            if old_port is None:
                os.environ.pop("PORT", None)
            else:
                os.environ["PORT"] = old_port
            if old_vanna is None:
                os.environ.pop("VANNA_BASE_URL", None)
            else:
                os.environ["VANNA_BASE_URL"] = old_vanna
            import config

            importlib.reload(config)


if __name__ == "__main__":
    unittest.main()
