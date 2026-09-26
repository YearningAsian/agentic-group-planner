"""Print a .docx file's paragraphs as plain text, one per line.

Usage: `python planning/tools/docx_text.py planning/master-plan.docx > out.txt`.
Reads word/document.xml directly, so it needs no third-party packages.
"""

import re
import sys
import zipfile


def paragraphs(path: str) -> list[str]:
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf8")
    result = []
    for paragraph in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", paragraph))
        if text.strip():
            result.append(text)
    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: docx_text.py <file.docx>")
    sys.stdout.reconfigure(encoding="utf-8")
    print("\n".join(paragraphs(sys.argv[1])))
