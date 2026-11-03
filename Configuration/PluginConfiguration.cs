using Jellyfin.Plugin.ScreenAdjust.Models;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.ScreenAdjust.Configuration;

public sealed class PluginConfiguration : BasePluginConfiguration
{
    public List<ScreenPreset> DefaultPresets { get; set; } = [];

    public List<UserProfileEntry> UserProfiles { get; set; } = [];

    public static List<ScreenPreset> CreateBuiltInDefaultPresets() =>
    [
        new ScreenPreset
        {
            Id = "default",
            Name = "Default",
            WidthPercent = 100,
            HeightPercent = 100,
            OffsetXPercent = 0,
            OffsetYPercent = 0
        },
        new ScreenPreset
        {
            Id = "centered-50",
            Name = "50% - Centered",
            WidthPercent = 50,
            HeightPercent = 50,
            OffsetXPercent = 0,
            OffsetYPercent = 0
        },
        new ScreenPreset
        {
            Id = "centered-75",
            Name = "75% - Centered",
            WidthPercent = 75,
            HeightPercent = 75,
            OffsetXPercent = 0,
            OffsetYPercent = 0
        },
        new ScreenPreset
        {
            Id = "centered-85",
            Name = "85% - Centered",
            WidthPercent = 85,
            HeightPercent = 85,
            OffsetXPercent = 0,
            OffsetYPercent = 0
        }
    ];
}
