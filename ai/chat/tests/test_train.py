import unittest

from train import build_system_prompt


class TrainPromptTests(unittest.TestCase):
    def test_flowindex_prompt_uses_flowindex_schema(self):
        prompt = build_system_prompt("flowindex")
        self.assertIn("FlowIndex PostgreSQL database", prompt)
        self.assertIn("raw.transactions", prompt)
        self.assertIn("app.market_prices", prompt)
        self.assertNotIn("WFLOW holders", prompt)

    def test_evm_prompt_uses_blockscout_schema(self):
        prompt = build_system_prompt("evm")
        self.assertIn("Flow EVM Blockscout database", prompt)
        self.assertIn("WFLOW", prompt)
        self.assertIn("transactions.status: 1 = success, 0 = failure", prompt)
        self.assertNotIn("raw.transactions", prompt)

    def test_invalid_target_raises(self):
        with self.assertRaises(ValueError):
            build_system_prompt("unknown")


if __name__ == "__main__":
    unittest.main()
