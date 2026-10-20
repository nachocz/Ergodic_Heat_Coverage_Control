"""The files built by tools/build_web.py match their sources, and the pages load only
files that need no CORS request (so that they work on anonymous.4open.science and from
the disk). Runs without Node.js: the bundles carry the digest of the module sources.
"""
import importlib.util
import os
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
spec = importlib.util.spec_from_file_location("build_web", ROOT / "tools" / "build_web.py")
build_web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_web)


class WebBuild(unittest.TestCase):
    def test_bundles_match_sources(self):
        digest = build_web.sources_digest()
        for page in build_web.PAGES:
            text = (DOCS / "js" / "dist" / f"{page}.js").read_text(encoding="utf-8")
            self.assertTrue(text.startswith(build_web.bundle_header(page, digest)),
                            f"docs/js/dist/{page}.js is out of date: run python tools/build_web.py")

    def test_fields_script_matches_json(self):
        text = (DOCS / "data" / "fields.js").read_text(encoding="utf-8")
        self.assertEqual(text, build_web.fields_js(), "docs/data/fields.js is out of date: run python tools/build_web.py")

    def test_katex_fonts_embedded(self):
        css = (DOCS / "vendor" / "katex" / "katex.inline.min.css").read_text(encoding="utf-8")
        self.assertEqual(css, build_web.katex_css())

    def test_pages_load_classic_scripts_only(self):
        for name in ("index.html", "problem.html", "control.html", "stability.html", "player.html"):
            html = (DOCS / name).read_text(encoding="utf-8")
            self.assertNotIn('type="module"', html, name)
            self.assertNotIn("katex.min.css", html, name)
            for src in re.findall(r'<script[^>]*\ssrc="([^"]+)"', html):
                self.assertTrue((DOCS / src).is_file(), f"{name}: missing {src}")


if __name__ == "__main__":
    unittest.main()
