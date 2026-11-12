class EdithError(Exception):
    """Base for domain errors; the API layer maps each subclass to an HTTP status."""


class ProjectNotFound(EdithError):
    pass


class ProjectExists(EdithError):
    pass


class InvalidProjectName(EdithError):
    pass


class NotAProjectFile(EdithError):
    """The file is not an Edith project (not SQLite, or missing the format marker)."""


class AmbiguousProject(EdithError):
    """A folder has more than one .edith file, so it is not clear which project is meant."""


class UnsupportedVersion(EdithError):
    """The file or a document in it was written by a newer Edith than this one."""


class ReadOnlyProject(EdithError):
    """A write was attempted on a project opened read-only."""


class InvalidFolderName(EdithError):
    """A new folder's name is empty, has a slash, or starts with a dot (so it would be hidden)."""


class FolderExists(EdithError):
    pass


class MediaNotFound(EdithError):
    pass


class InvalidMediaPath(EdithError):
    """A path outside the project folder, absolute, or otherwise not a usable media file."""


class MediaError(EdithError):
    """ffprobe/ffmpeg could not read or process a file."""


class InvalidTemplate(EdithError):
    """The registration-sound excerpt is empty, too long, or silent."""


class InvalidEdit(EdithError):
    """The edit refers to unknown media or has an impossible range."""
