"""System dependency checker for the application."""
import subprocess
import shutil
import platform
import os
import sys
from typing import Dict, List, Tuple
import logging

logger = logging.getLogger(__name__)


def _configured_tool_path(variable: str):
    value = os.getenv(variable, "").strip()
    if not value:
        return None
    if not os.path.isabs(value) or not os.path.isfile(value) or not os.access(value, os.X_OK):
        raise ValueError(f"{variable} must name an existing absolute executable file on the backend")
    return value


def get_ffmpeg_path() -> str:
    """
    Get FFmpeg: explicit FFMPEG_PATH, bundled version, then system discovery.

    For packaged applications (PyInstaller, etc.), this will first look for
    a bundled ffmpeg in the application directory, then fall back to system PATH,
    then check common installation paths (especially useful on Windows).

    Returns:
        Path to ffmpeg executable, or None if not found
    """
    configured = _configured_tool_path("FFMPEG_PATH")
    if configured:
        return configured

    # For PyInstaller or similar packagers
    if getattr(sys, 'frozen', False):
        # Running in a bundle
        bundle_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))

        # Try common bundle locations
        ffmpeg_name = 'ffmpeg.exe' if platform.system() == 'Windows' else 'ffmpeg'
        possible_paths = [
            os.path.join(bundle_dir, 'bin', ffmpeg_name),
            os.path.join(bundle_dir, 'ffmpeg', ffmpeg_name),
            os.path.join(bundle_dir, ffmpeg_name),
        ]

        for path in possible_paths:
            if os.path.exists(path) and os.access(path, os.X_OK):
                logger.info(f"Using bundled ffmpeg at: {path}")
                return path

    # Fall back to system ffmpeg via PATH
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        logger.info(f"Using system ffmpeg at: {system_ffmpeg}")
        return system_ffmpeg

    # On Windows, shutil.which() may fail if PATH wasn't refreshed after install.
    # Check common Windows installation paths as fallback.
    if platform.system() == "Windows":
        common_windows_paths = [
            os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("USERPROFILE", ""), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("USERPROFILE", ""), "Desktop", "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("USERPROFILE", ""), "Downloads", "ffmpeg", "bin", "ffmpeg.exe"),
            # Scoop package manager
            os.path.join(os.environ.get("USERPROFILE", ""), "scoop", "shims", "ffmpeg.exe"),
            # Chocolatey package manager
            os.path.join(os.environ.get("ChocolateyInstall", "C:\\ProgramData\\chocolatey"), "bin", "ffmpeg.exe"),
            # winget / common manual installs
            "C:\\ffmpeg\\bin\\ffmpeg.exe",
            "C:\\tools\\ffmpeg\\bin\\ffmpeg.exe",
        ]
        for path in common_windows_paths:
            if path and os.path.isfile(path):
                logger.info(f"Using ffmpeg found at common Windows path: {path}")
                return path

        logger.warning(
            "FFmpeg not found in PATH or common Windows paths. "
            "If FFmpeg is installed, ensure its 'bin' folder is in the system PATH "
            "and restart the application."
        )

    return None


def get_ffprobe_path(ffmpeg_path=None):
    """Resolve the probe independently, preferring the selected FFmpeg's sibling."""
    configured = _configured_tool_path("FFPROBE_PATH")
    if configured:
        return configured
    ffmpeg_path = ffmpeg_path or get_ffmpeg_path()
    if ffmpeg_path:
        name = "ffprobe.exe" if ffmpeg_path.lower().endswith(".exe") else "ffprobe"
        sibling = os.path.join(os.path.dirname(ffmpeg_path), name)
        if os.path.isfile(sibling) and os.access(sibling, os.X_OK):
            return sibling
    return shutil.which("ffprobe")


def resolve_media_command(command):
    """Resolve a media executable while preserving every argv boundary."""
    resolvers = {"ffmpeg": get_ffmpeg_path, "ffprobe": get_ffprobe_path}
    if not command or command[0] not in resolvers:
        raise ValueError("Unsupported media tool")
    executable = resolvers[command[0]]()
    if not executable:
        raise ValueError("FFmpeg/FFprobe is unavailable")
    return [executable, *command[1:]]


def _check_media_tool(name, resolver):
    try:
        executable = resolver()
    except ValueError as exc:
        return False, str(exc)
    if not executable:
        return False, f"{name} not found in bundle or system PATH"
    try:
        result = subprocess.run([executable, "-version"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0] if result.stdout else "Unknown version"
            return True, f"Found at {executable}: {version_line}"
        return False, f"{name} found at {executable} but returned error code {result.returncode}"
    except subprocess.TimeoutExpired:
        return False, f"{name} at {executable} timed out"
    except Exception as exc:
        logger.warning("%s check failed at %s: %s", name, executable, exc)
        return False, f"{name} found at {executable} but not working ({type(exc).__name__})"


def check_ffmpeg() -> Tuple[bool, str]:
    return _check_media_tool("FFmpeg", get_ffmpeg_path)


def check_ffprobe() -> Tuple[bool, str]:
    return _check_media_tool("FFprobe", get_ffprobe_path)


def get_system_info() -> Dict[str, str]:
    """Get basic system information for debugging."""
    return {
        "platform": platform.system(),
        "platform_version": platform.version(),
        "platform_release": platform.release(),
        "python_version": platform.python_version(),
        "machine": platform.machine(),
        "processor": platform.processor(),
    }


def run_system_checks() -> Dict[str, any]:
    """Report the exact process-local media tool dependencies, including bad config."""
    dependencies = {}
    for name, resolver, checker in (
        ("ffmpeg", get_ffmpeg_path, check_ffmpeg),
        ("ffprobe", get_ffprobe_path, check_ffprobe),
    ):
        available, message = checker()
        try:
            executable = resolver()
        except ValueError:
            executable = None
        dependencies[name] = {"available": available, "message": message, "path": executable}
    return {
        "system_info": get_system_info(),
        "dependencies": dependencies,
        "status": "ok" if all(item["available"] for item in dependencies.values()) else "warning",
    }


def get_ffmpeg_install_instructions() -> str:
    """
    Get platform-specific installation instructions for ffmpeg.
    
    Note: For bundled applications, this is mainly for fallback scenarios.
    """
    system = platform.system()
    
    if system == "Windows":
        return (
            "FFmpeg Installation (Windows):\n"
            "1. Download from: https://www.gyan.dev/ffmpeg/builds/\n"
            "2. Extract the downloaded file\n"
            "3. Add the 'bin' folder to your system PATH\n"
            "4. Restart the application\n\n"
            "Alternatively, download from: https://ffmpeg.org/download.html"
        )
    elif system == "Darwin":  # macOS
        return (
            "FFmpeg Installation (macOS):\n"
            "1. Install Homebrew if not already installed: https://brew.sh/\n"
            "2. Open Terminal and run: brew install ffmpeg\n"
            "3. Restart the application\n\n"
            "Alternatively, download from: https://ffmpeg.org/download.html"
        )
    elif system == "Linux":
        return (
            "FFmpeg Installation (Linux):\n"
            "Ubuntu/Debian: sudo apt-get update && sudo apt-get install ffmpeg\n"
            "Fedora: sudo dnf install ffmpeg\n"
            "Arch Linux: sudo pacman -S ffmpeg\n\n"
            "Or download from: https://ffmpeg.org/download.html"
        )
    else:
        return (
            "FFmpeg Installation:\n"
            "Please visit https://ffmpeg.org/download.html for installation instructions\n"
            "for your operating system."
        )
