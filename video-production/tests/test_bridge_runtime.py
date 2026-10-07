import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "scripts")]

spec = importlib.util.spec_from_file_location(
    "cit126_bridge", ROOT / "backend" / "bridge.py"
)
bridge = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(bridge)


class BridgeRuntimeTests(unittest.TestCase):
    def test_uid_is_available_for_ai_usage_recording(self):
        value = bridge.uid()
        self.assertIsInstance(value, str)
        self.assertGreater(len(value), 20)


if __name__ == "__main__":
    unittest.main()
