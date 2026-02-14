#!/usr/bin/env python3
"""GUI launcher for the Bible timeline web viewer.

Features:
- Build web data JSON (all verses mode)
- Start/stop static HTTP server for /web
- Open browser to viewer URL
- Exit button that also stops server
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
import glob
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, X, BooleanVar, IntVar, StringVar, Tk, Text
from tkinter import ttk, messagebox

PROJECT_ROOT = Path(__file__).resolve().parent
SCRIPT_BUILD_WEB_DATA = PROJECT_ROOT / "scripts" / "build_web_data.py"
WEB_DIR = PROJECT_ROOT / "web"
WEB_DATA = WEB_DIR / "data" / "timeline.json"


class TimelineLauncher:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title("성경 타임라인 실행기")
        self.root.geometry("880x620")
        self.root.minsize(820, 520)

        self.port_var = IntVar(value=8080)
        self.url_var = StringVar(value="")
        self.auto_open_var = BooleanVar(value=True)

        self.server_process: subprocess.Popen[str] | None = None
        self.server_thread: threading.Thread | None = None
        self._stop_reader = threading.Event()

        self._build_ui()
        self._update_url()
        self._set_status("대기 중")

        self.root.protocol("WM_DELETE_WINDOW", self.on_exit)

    def _build_ui(self) -> None:
        style = ttk.Style()
        if "aqua" in style.theme_names():
            style.theme_use("aqua")

        container = ttk.Frame(self.root, padding=14)
        container.pack(fill=BOTH, expand=True)

        title = ttk.Label(container, text="성경 타임라인 웹 실행기", font=("Apple SD Gothic Neo", 18, "bold"))
        title.pack(anchor="w")

        subtitle = ttk.Label(
            container,
            text="데이터 빌드 + 로컬 웹서버 실행 + 브라우저 열기를 한 번에 관리합니다.",
        )
        subtitle.pack(anchor="w", pady=(4, 10))

        config_frame = ttk.LabelFrame(container, text="실행 설정", padding=10)
        config_frame.pack(fill=X)

        port_row = ttk.Frame(config_frame)
        port_row.pack(fill=X)
        ttk.Label(port_row, text="포트").pack(side=LEFT)
        ttk.Spinbox(port_row, from_=1024, to=65535, textvariable=self.port_var, width=8, command=self._update_url).pack(
            side=LEFT, padx=(8, 14)
        )
        ttk.Checkbutton(port_row, text="서버 시작 후 브라우저 자동 열기", variable=self.auto_open_var).pack(side=LEFT)

        url_row = ttk.Frame(config_frame)
        url_row.pack(fill=X, pady=(8, 0))
        ttk.Label(url_row, text="접속 URL").pack(side=LEFT)
        ttk.Entry(url_row, textvariable=self.url_var, state="readonly").pack(side=LEFT, fill=X, expand=True, padx=(8, 0))

        btn_frame = ttk.Frame(container)
        btn_frame.pack(fill=X, pady=(12, 8))

        self.btn_build = ttk.Button(btn_frame, text="1) 데이터 빌드", command=self.build_data)
        self.btn_start = ttk.Button(btn_frame, text="2) 서버 시작", command=self.start_server)
        self.btn_open = ttk.Button(btn_frame, text="3) 브라우저 열기", command=self.open_browser)
        self.btn_stop = ttk.Button(btn_frame, text="서버 중지", command=self.stop_server)
        self.btn_exit = ttk.Button(btn_frame, text="종료", command=self.on_exit)

        self.btn_build.pack(side=LEFT)
        self.btn_start.pack(side=LEFT, padx=(8, 0))
        self.btn_open.pack(side=LEFT, padx=(8, 0))
        self.btn_stop.pack(side=LEFT, padx=(8, 0))
        self.btn_exit.pack(side=RIGHT)

        status_row = ttk.Frame(container)
        status_row.pack(fill=X)
        ttk.Label(status_row, text="상태").pack(side=LEFT)
        self.status_label = ttk.Label(status_row, text="")
        self.status_label.pack(side=LEFT, padx=(8, 0))

        log_frame = ttk.LabelFrame(container, text="실행 로그", padding=8)
        log_frame.pack(fill=BOTH, expand=True, pady=(8, 0))

        self.log_text = Text(log_frame, height=22, wrap="word")
        self.log_text.pack(fill=BOTH, expand=True)
        self.log_text.configure(state="disabled")

        self.port_var.trace_add("write", lambda *_: self._update_url())

    def _update_url(self) -> None:
        port = self._safe_port()
        self.url_var.set(f"http://127.0.0.1:{port}")

    def _safe_port(self) -> int:
        try:
            port = int(self.port_var.get())
        except Exception:
            port = 8080
        if port < 1024 or port > 65535:
            port = 8080
            self.port_var.set(port)
        return port

    def _set_status(self, text: str) -> None:
        self.status_label.configure(text=text)

    def _append_log(self, text: str) -> None:
        self.log_text.configure(state="normal")
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.insert(END, f"[{timestamp}] {text}\n")
        self.log_text.see(END)
        self.log_text.configure(state="disabled")

    def _run_cmd(self, cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
        self._append_log(f"실행: {' '.join(cmd)}")
        proc = subprocess.run(
            cmd,
            cwd=str(cwd or PROJECT_ROOT),
            capture_output=True,
            text=True,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        if out.strip():
            for line in out.strip().splitlines():
                self._append_log(line)
        return proc.returncode, out

    def _detect_source_dir(self) -> str | None:
        patterns = [
            "/Users/daniel/Documents/*MacBook*2/원어연구/개역개정-pdf, txt/개역개정-text",
            "/Users/daniel/Documents/*/원어연구/개역개정-pdf, txt/개역개정-text",
        ]
        for pattern in patterns:
            for candidate in glob.glob(pattern):
                path = Path(candidate)
                if not path.is_dir():
                    continue
                count = sum(1 for p in path.iterdir() if p.suffix.lower() == ".txt")
                if count >= 66:
                    return str(path)
        return None

    def build_data(self) -> None:
        if not SCRIPT_BUILD_WEB_DATA.exists():
            messagebox.showerror("오류", f"빌드 스크립트를 찾을 수 없습니다.\n{SCRIPT_BUILD_WEB_DATA}")
            return

        self._set_status("전체구절 데이터 빌드 중...")
        cmd = [
            sys.executable,
            str(SCRIPT_BUILD_WEB_DATA),
            "--mode",
            "all_verses",
            "--output",
            str(WEB_DATA),
        ]
        source_dir = self._detect_source_dir()
        if source_dir:
            cmd.extend(["--source-dir", source_dir])

        rc, _ = self._run_cmd(
            cmd
        )
        if rc == 0:
            self._set_status("전체구절 데이터 빌드 완료")
            self._append_log(f"완료: {WEB_DATA}")
            try:
                payload = json.loads(WEB_DATA.read_text(encoding="utf-8"))
                meta = payload.get("meta", {}) if isinstance(payload, dict) else {}
                total_chapters = meta.get("totalChapters")
                total_verses = meta.get("totalVerses")
                if total_chapters is not None and total_verses is not None:
                    self._append_log(f"장 단위 집계: 총 {total_chapters}장 / {total_verses}절")
            except Exception as exc:
                self._append_log(f"메타 정보 읽기 실패: {exc}")
        else:
            self._set_status("데이터 빌드 실패")
            messagebox.showerror("빌드 실패", "데이터 빌드 중 오류가 발생했습니다. 로그를 확인하세요.")

    def _is_port_open(self, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    def _read_server_output(self) -> None:
        if not self.server_process or not self.server_process.stdout:
            return
        while not self._stop_reader.is_set():
            line = self.server_process.stdout.readline()
            if not line:
                break
            self._append_log(line.rstrip())

    def start_server(self) -> None:
        if self.server_process and self.server_process.poll() is None:
            self._append_log("서버가 이미 실행 중입니다.")
            self._set_status("서버 실행 중")
            return

        port = self._safe_port()
        if self._is_port_open(port):
            messagebox.showerror("포트 사용 중", f"포트 {port}가 이미 사용 중입니다. 다른 포트를 선택하세요.")
            self._set_status("대기 중")
            return

        if not WEB_DATA.exists():
            answer = messagebox.askyesno("데이터 없음", "timeline.json이 없습니다. 지금 빌드할까요?")
            if answer:
                self.build_data()
            if not WEB_DATA.exists():
                return

        self._set_status("서버 시작 중...")
        self._append_log(f"서버 시작: {self.url_var.get()}")

        cmd = [sys.executable, "-m", "http.server", str(port), "--directory", str(WEB_DIR)]
        self.server_process = subprocess.Popen(
            cmd,
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        self._stop_reader.clear()
        self.server_thread = threading.Thread(target=self._read_server_output, daemon=True)
        self.server_thread.start()

        time.sleep(0.5)
        if self.server_process.poll() is None:
            self._set_status("서버 실행 중")
            if self.auto_open_var.get():
                self.open_browser()
        else:
            self._set_status("서버 시작 실패")
            messagebox.showerror("서버 시작 실패", "http.server 시작에 실패했습니다. 로그를 확인하세요.")

    def stop_server(self) -> None:
        if not self.server_process or self.server_process.poll() is not None:
            self._append_log("중지할 서버가 없습니다.")
            self._set_status("대기 중")
            return

        self._append_log("서버 중지 요청")
        self._stop_reader.set()

        try:
            if os.name == "nt":
                self.server_process.terminate()
            else:
                self.server_process.send_signal(signal.SIGTERM)

            self.server_process.wait(timeout=3)
        except Exception:
            self.server_process.kill()
        finally:
            self.server_process = None
            self._set_status("서버 중지됨")
            self._append_log("서버가 중지되었습니다.")

    def open_browser(self) -> None:
        url = self.url_var.get()
        self._append_log(f"브라우저 열기: {url}")
        webbrowser.open(url)

    def on_exit(self) -> None:
        self._append_log("종료 버튼 클릭")
        try:
            self.stop_server()
        except Exception:
            pass
        self.root.destroy()


def main() -> None:
    root = Tk()
    app = TimelineLauncher(root)
    app._append_log("실행기 준비 완료")
    root.mainloop()


if __name__ == "__main__":
    main()
