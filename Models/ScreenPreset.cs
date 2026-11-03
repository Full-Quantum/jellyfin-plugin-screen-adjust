namespace Jellyfin.Plugin.ScreenAdjust.Models;

public sealed class ScreenPreset
{
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public int WidthPercent { get; set; } = 90;

    public int HeightPercent { get; set; } = 90;

    public double OffsetXPercent { get; set; }

    public double OffsetYPercent { get; set; }

    public bool BorderEnabled { get; set; }

    public string BorderColor { get; set; } = "#ffffff";

    public int BorderWidthPx { get; set; } = 4;

    public int BorderTransparencyPercent { get; set; }

    public ScreenPreset Copy()
    {
        return new ScreenPreset
        {
            Id = Id,
            Name = Name,
            WidthPercent = WidthPercent,
            HeightPercent = HeightPercent,
            OffsetXPercent = OffsetXPercent,
            OffsetYPercent = OffsetYPercent,
            BorderEnabled = BorderEnabled,
            BorderColor = BorderColor,
            BorderWidthPx = BorderWidthPx,
            BorderTransparencyPercent = BorderTransparencyPercent
        };
    }
}
