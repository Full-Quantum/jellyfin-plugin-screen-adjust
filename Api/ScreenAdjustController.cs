using System.Security.Claims;
using Jellyfin.Plugin.ScreenAdjust.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.ScreenAdjust.Api;

[ApiController]
[Authorize]
[Route("ScreenAdjust")]
public sealed class ScreenAdjustController : ControllerBase
{
    private const int MaximumPresets = 20;
    private const string UserIdClaimType = "Jellyfin-UserId";
    private readonly Plugin _plugin;

    public ScreenAdjustController()
    {
        _plugin = Plugin.Instance ?? throw new InvalidOperationException("The Screen Adjust plugin is not initialized.");
    }

    [HttpGet("profile")]
    public ActionResult<UserProfileResponse> GetProfile()
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        var profile = _plugin.GetUserProfile(userId);
        var defaultPresets = _plugin.GetDefaultPresets();
        return Ok(new UserProfileResponse
        {
            Presets = profile.Presets,
            SelectedPresetId = profile.SelectedPresetId,
            SelectedDefaultPresetId = defaultPresets.Any(preset => preset.Id == profile.SelectedDefaultPresetId)
                ? profile.SelectedDefaultPresetId
                : null,
            UseFullSize = profile.UseFullSize,
            DefaultPresets = defaultPresets
        });
    }

    [HttpPut("profile")]
    public IActionResult SaveProfile([FromBody] UserProfileRequest request)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized();
        }

        if (!TryValidatePresets(request.Presets, out var validationError))
        {
            return BadRequest(validationError);
        }

        if (request.SelectedPresetId is not null
            && !request.Presets.Any(preset => preset.Id == request.SelectedPresetId))
        {
            return BadRequest("The selected preset must belong to this account.");
        }

        var defaultPresets = _plugin.GetDefaultPresets();
        if (request.SelectedDefaultPresetId is not null
            && !defaultPresets.Any(preset => preset.Id == request.SelectedDefaultPresetId))
        {
            return BadRequest("The selected default preset must be available on this server.");
        }

        if ((request.SelectedPresetId is not null && request.SelectedDefaultPresetId is not null)
            || (request.UseFullSize
                && (request.SelectedPresetId is not null || request.SelectedDefaultPresetId is not null)))
        {
            return BadRequest("Select either a personal preset, a server default, or full-size mode.");
        }

        _plugin.SetUserProfile(userId, new UserProfileData
        {
            Presets = request.Presets,
            SelectedPresetId = request.SelectedPresetId,
            SelectedDefaultPresetId = request.SelectedDefaultPresetId,
            UseFullSize = request.UseFullSize
        });
        return NoContent();
    }

    [HttpGet("defaults")]
    public ActionResult<List<ScreenPreset>> GetDefaults()
    {
        if (!IsAdministrator(User))
        {
            return Forbid();
        }

        return Ok(_plugin.GetDefaultPresets());
    }

    [HttpPut("defaults")]
    public IActionResult SaveDefaults([FromBody] List<ScreenPreset> presets)
    {
        if (!IsAdministrator(User))
        {
            return Forbid();
        }

        if (!TryValidatePresets(presets, out var validationError))
        {
            return BadRequest(validationError);
        }

        _plugin.SetDefaultPresets(presets);
        return NoContent();
    }

    private static bool IsAdministrator(ClaimsPrincipal user)
    {
        return user.IsInRole("Administrator");
    }

    private bool TryGetUserId(out Guid userId)
    {
        return Guid.TryParse(User.FindFirst(UserIdClaimType)?.Value, out userId)
            && userId != Guid.Empty;
    }

    private static bool TryValidatePresets(IReadOnlyCollection<ScreenPreset>? presets, out string error)
    {
        if (presets is null || presets.Count > MaximumPresets)
        {
            error = $"Presets must contain between 0 and {MaximumPresets} entries.";
            return false;
        }

        if (presets.Any(preset =>
                string.IsNullOrWhiteSpace(preset.Id)
                || preset.Id.Length > 64
                || string.IsNullOrWhiteSpace(preset.Name)
                || preset.Name.Length > 40
                || preset.WidthPercent is < 50 or > 100
                || preset.HeightPercent is < 50 or > 100
                || !double.IsFinite(preset.OffsetXPercent)
                || preset.OffsetXPercent is < -20 or > 20
                || !double.IsFinite(preset.OffsetYPercent)
                || preset.OffsetYPercent is < -20 or > 20
                || preset.BorderColor is null
                || !System.Text.RegularExpressions.Regex.IsMatch(
                    preset.BorderColor,
                    "^#[0-9a-fA-F]{6}$",
                    System.Text.RegularExpressions.RegexOptions.CultureInvariant)
                || preset.BorderWidthPx is < 1 or > 20
                || preset.BorderTransparencyPercent is < 0 or > 100))
        {
            error = "Each preset needs a name (up to 40 characters), a unique ID, size values from 50 to 100, finite offsets from -20 to 20, a six-digit border color, border width from 1 to 20 pixels, and border transparency from 0 to 100 percent.";
            return false;
        }

        if (presets.Select(preset => preset.Id).Distinct(StringComparer.Ordinal).Count() != presets.Count)
        {
            error = "Preset IDs must be unique.";
            return false;
        }

        error = string.Empty;
        return true;
    }
}
