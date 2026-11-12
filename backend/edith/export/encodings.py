"""The output formats a render can be encoded as: a codec, its audio, and the container."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Encoding:
    label: str
    ext: str
    mime: str
    video: tuple[str, ...]
    audio: tuple[str, ...]
    container: tuple[str, ...] = ()


ENCODINGS: dict[str, Encoding] = {
    # What it has always been: small, plays anywhere.
    "h264": Encoding(
        label="H.264 · MP4",
        ext="mp4",
        mime="video/mp4",
        video=("-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"),
        audio=("-c:a", "aac", "-b:a", "192k"),
        container=("-movflags", "+faststart"),
    ),
    # About half the size at the same quality; `hvc1` makes it play in Apple's players.
    "h265": Encoding(
        label="H.265 · MP4",
        ext="mp4",
        mime="video/mp4",
        video=(
            *("-c:v", "libx265", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p"),
            *("-tag:v", "hvc1"),
        ),
        audio=("-c:a", "aac", "-b:a", "192k"),
        container=("-movflags", "+faststart"),
    ),
    # For finishing in another editor: big, but intra-frame and near-lossless.
    "prores": Encoding(
        label="ProRes 422 HQ · MOV",
        ext="mov",
        mime="video/quicktime",
        video=("-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"),
        audio=("-c:a", "pcm_s24le"),
    ),
}
DEFAULT_ENCODING = "h264"
