#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
exec python3 launcher_gui.py
