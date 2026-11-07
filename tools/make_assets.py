"""Generate icons and the preset calendar files in ics/.

Each file repeats every Monday to Friday, so no personal dates are needed.
Reminder times follow the same rule as slots() in app.js.

Usage: python3 tools/make_assets.py
"""
import datetime as dt
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
URL = "https://baicao7788-cyber.github.io/stand-up/"
LUNCH = (12 * 60, 13 * 60 + 30)
HOURS = {"0900-1800": (9 * 60, 18 * 60), "0930-1830": (9 * 60 + 30, 18 * 60 + 30), "1000-1900": (10 * 60, 19 * 60)}
INTERVALS = (30, 45, 60, 90)
WEEKDAYS = ("MO", "TU", "WE", "TH", "FR")
FIRST_MONDAY = dt.date(2026, 11, 2)

MOVES = [
    ("起身接杯水", "走到茶水间，顺便喝几口"),
    ("远眺 20 秒", "看 6 米外的地方，让眼睛歇一下"),
    ("肩颈放松", "肩膀向后绕 10 圈，头慢慢左右侧倾各 15 秒"),
    ("拉伸腿后侧", "脚跟搭在低处，身体前倾，每边 20 秒"),
    ("爬一层楼梯", "上下一层，比坐电梯好"),
    ("靠墙站 1 分钟", "后脑、肩、臀、脚跟贴墙，打开含着的胸"),
    ("原地踮脚 20 次", "活动小腿，帮助血液回流"),
    ("扩胸加转体", "双手打开扩胸 10 次，再左右转体各 5 次"),
    ("手腕手指拉伸", "手臂前伸，另一只手把手指往回扳，每边 15 秒"),
    ("走去找同事说句话", "能当面说的，就别发消息"),
]


def slots(start: int, end: int, interval: int) -> list[int]:
    out = list(range(start + interval, LUNCH[0] - 10 + 1, interval))
    out += list(range(LUNCH[1] + interval, end - 10 + 1, interval))
    return out


def make_icon(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size), "#dcefe9")
    d = ImageDraw.Draw(img)
    pad = size * 0.16
    d.ellipse([pad, pad, size - pad, size - pad], fill="#2f7d6d")
    font = None
    for path in ["/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        try:
            font = ImageFont.truetype(path, int(size * 0.36))
            break
        except OSError:
            continue
    text = "走"
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), text, fill="#ffffff", font=font)
    return img


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def fold(line: str) -> str:
    out, cur, n = [], "", 0
    for ch in line:
        b = len(ch.encode("utf-8"))
        if n + b > 73:
            out.append(cur)
            cur, n = " ", 1
        cur += ch
        n += b
    out.append(cur)
    return "\r\n".join(out)


def make_ics(key: str, interval: int) -> str:
    start, end = HOURS[key]
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//stand-up//CN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", "X-WR-CALNAME:起来走走"]
    for wi, wd in enumerate(WEEKDAYS):
        day = FIRST_MONDAY + dt.timedelta(days=wi)
        for k, t in enumerate(slots(start, end, interval)):
            name, how = MOVES[(wi * 7 + k) % len(MOVES)]
            begin = dt.datetime.combine(day, dt.time(t // 60, t % 60))
            stop = begin + dt.timedelta(minutes=2)
            title = f"起来动一动 · {name}"
            lines += ["BEGIN:VEVENT", f"UID:su-{key}-{interval}-{wd}-{t}@stand-up", f"DTSTAMP:{stamp}",
                      f"DTSTART:{begin:%Y%m%dT%H%M%S}", f"DTEND:{stop:%Y%m%dT%H%M%S}",
                      f"RRULE:FREQ=WEEKLY;BYDAY={wd}", "TRANSP:TRANSPARENT",
                      fold("SUMMARY:" + esc(title)),
                      fold("DESCRIPTION:" + esc(f"{how}\n动完点一下：{URL}")),
                      "BEGIN:VALARM", "ACTION:DISPLAY", fold("DESCRIPTION:" + esc(title)),
                      "TRIGGER:-PT0M", "END:VALARM", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def main():
    make_icon(180).save(ROOT / "icon-180.png")
    make_icon(512).save(ROOT / "icon-512.png")
    out = ROOT / "ics"
    out.mkdir(exist_ok=True)
    for key in HOURS:
        for iv in INTERVALS:
            (out / f"{key}-{iv}.ics").write_bytes(make_ics(key, iv).encode("utf-8"))
    print("ok", len(HOURS) * len(INTERVALS), "files")


if __name__ == "__main__":
    main()
