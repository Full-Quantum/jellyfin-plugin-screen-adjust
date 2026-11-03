namespace Jellyfin.Plugin.ScreenAdjust.Models;

public sealed class UserProfileEntry
{
    public string UserId { get; set; } = string.Empty;

    public List<ScreenPreset> Presets { get; set; } = [];

    public string? SelectedPresetId { get; set; }

    public string? SelectedDefaultPresetId { get; set; }

    public bool UseFullSize { get; set; }
}
