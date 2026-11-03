namespace Jellyfin.Plugin.ScreenAdjust.Models;

public sealed class UserProfileResponse
{
    public List<ScreenPreset> Presets { get; init; } = [];

    public string? SelectedPresetId { get; init; }

    public string? SelectedDefaultPresetId { get; init; }

    public bool UseFullSize { get; init; }

    public List<ScreenPreset> DefaultPresets { get; init; } = [];
}
