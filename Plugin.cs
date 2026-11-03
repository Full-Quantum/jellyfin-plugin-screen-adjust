using System.Globalization;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using Jellyfin.Plugin.ScreenAdjust.Configuration;
using Jellyfin.Plugin.ScreenAdjust.Models;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.ScreenAdjust;

public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    private readonly object _sync = new();
    private readonly ILogger<Plugin> _logger;

    public Plugin(
        IApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer,
        ILogger<Plugin> logger)
        : base(applicationPaths, xmlSerializer)
    {
        _logger = logger;
        Instance = this;
        EnsureBuiltInDefaultPresets();
        RegisterClientScript();
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Screen Adjust";

    public override Guid Id => Guid.Parse("89a306f8-35ed-43b0-86b4-35d1c1ad1029");

    private void RegisterClientScript()
    {
        try
        {
            RegisterClientScriptCore();
        }
        catch (TargetInvocationException exception)
        {
            _logger.LogError(
                exception.InnerException ?? exception,
                "JavaScript Injector failed while registering Screen Adjust controls.");
        }
        catch (Exception exception) when (exception is
            ArgumentException or
            InvalidOperationException or
            IOException or
            JsonException or
            AmbiguousMatchException or
            MemberAccessException)
        {
            _logger.LogError(exception, "Could not register Screen Adjust controls with JavaScript Injector.");
        }
    }

    private void RegisterClientScriptCore()
    {
        var injectorAssembly = AssemblyLoadContext.All
            .SelectMany(context => context.Assemblies)
            .FirstOrDefault(assembly =>
                assembly.GetName().Name == "Jellyfin.Plugin.JavaScriptInjector");
        if (injectorAssembly is null)
        {
            _logger.LogWarning(
                "JavaScript Injector was not found. Install and enable that plugin for Screen Adjust controls in Jellyfin Web.");
            return;
        }

        var interfaceType = injectorAssembly.GetType(
            "Jellyfin.Plugin.JavaScriptInjector.PluginInterface");
        var registerMethod = interfaceType?.GetMethod(
            "RegisterScript",
            BindingFlags.Public | BindingFlags.Static);
        var payloadType = registerMethod?.GetParameters().SingleOrDefault()?.ParameterType;
        var parseMethod = payloadType?.GetMethod(
            "Parse",
            BindingFlags.Public | BindingFlags.Static,
            [typeof(string)]);
        if (registerMethod is null || payloadType is null || parseMethod is null)
        {
            _logger.LogError(
                "The installed JavaScript Injector does not expose the supported script registration interface.");
            return;
        }

        var resourceName = GetType().Assembly.GetManifestResourceNames()
            .SingleOrDefault(name => name.EndsWith(
                ".client.ScreenAdjust.user.js",
                StringComparison.Ordinal));
        if (resourceName is null)
        {
            _logger.LogError("The embedded Screen Adjust client script was not found.");
            return;
        }

        using var stream = GetType().Assembly.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            _logger.LogError("The embedded Screen Adjust client script could not be opened.");
            return;
        }

        using var reader = new StreamReader(stream);
        var clientScript = RemoveUserScriptMetadata(reader.ReadToEnd());
        var registrationJson = JsonSerializer.Serialize(new
        {
            id = $"{Id}-client",
            name = "Screen Adjust",
            script = clientScript,
            enabled = true,
            requiresAuthentication = true,
            pluginId = Id.ToString(),
            pluginName = Name,
            pluginVersion = Version.ToString()
        });

        var payload = parseMethod.Invoke(null, [registrationJson]);
        if (payload is null)
        {
            _logger.LogError("Could not create the JavaScript Injector registration payload.");
            return;
        }

        if (registerMethod.Invoke(null, [payload]) is not true)
        {
            _logger.LogError("JavaScript Injector rejected the Screen Adjust client script.");
            return;
        }

        _logger.LogInformation("Registered the Screen Adjust client controls with JavaScript Injector.");
    }

    private static string RemoveUserScriptMetadata(string script)
    {
        const string startMarker = "// ==UserScript==";
        const string endMarker = "// ==/UserScript==";
        var start = script.IndexOf(startMarker, StringComparison.Ordinal);
        var end = start < 0
            ? -1
            : script.IndexOf(endMarker, start, StringComparison.Ordinal);
        if (start < 0 || end < 0)
        {
            throw new InvalidDataException("The embedded client script has no valid userscript metadata block.");
        }

        var contentStart = script.IndexOf('\n', end);
        return contentStart < 0
            ? string.Empty
            : string.Concat(script.AsSpan(0, start), script.AsSpan(contentStart + 1));
    }

    public IEnumerable<PluginPageInfo> GetPages()
    {
        yield return new PluginPageInfo
        {
            Name = "ScreenAdjust",
            DisplayName = Name,
            EmbeddedResourcePath = string.Format(
                CultureInfo.InvariantCulture,
                "{0}.Configuration.configPage.html",
                GetType().Namespace)
        };
    }

    public List<ScreenPreset> GetDefaultPresets()
    {
        lock (_sync)
        {
            if (AddMissingBuiltInDefaults())
            {
                SaveConfiguration();
            }

            return Configuration.DefaultPresets.Select(preset => preset.Copy()).ToList();
        }
    }

    public UserProfileData GetUserProfile(Guid userId)
    {
        lock (_sync)
        {
            var userIdString = userId.ToString("D");
            var profile = Configuration.UserProfiles.FirstOrDefault(
                entry => string.Equals(entry.UserId, userIdString, StringComparison.OrdinalIgnoreCase));
            if (profile is null)
            {
                return new UserProfileData();
            }

            return new UserProfileData
            {
                Presets = profile.Presets.Select(preset => preset.Copy()).ToList(),
                SelectedPresetId = profile.SelectedPresetId,
                SelectedDefaultPresetId = profile.SelectedDefaultPresetId,
                UseFullSize = profile.UseFullSize
            };
        }
    }

    public void SetUserProfile(Guid userId, UserProfileData profile)
    {
        lock (_sync)
        {
            var userIdString = userId.ToString("D");
            var storedProfile = new UserProfileEntry
            {
                UserId = userIdString,
                Presets = profile.Presets.Select(preset => preset.Copy()).ToList(),
                SelectedPresetId = profile.SelectedPresetId,
                SelectedDefaultPresetId = profile.SelectedDefaultPresetId,
                UseFullSize = profile.UseFullSize
            };

            var existingProfiles = Configuration.UserProfiles
                .Where(entry => !string.Equals(
                    entry.UserId,
                    userIdString,
                    StringComparison.OrdinalIgnoreCase))
                .ToList();
            existingProfiles.Add(storedProfile);
            Configuration.UserProfiles = existingProfiles;
            SaveConfiguration();
        }
    }

    public void SetDefaultPresets(IReadOnlyCollection<ScreenPreset> presets)
    {
        lock (_sync)
        {
            Configuration.DefaultPresets = presets.Select(preset => preset.Copy()).ToList();
            AddMissingBuiltInDefaults();
            SaveConfiguration();
        }
    }

    private void EnsureBuiltInDefaultPresets()
    {
        lock (_sync)
        {
            if (AddMissingBuiltInDefaults())
            {
                SaveConfiguration();
            }
        }
    }

    private bool AddMissingBuiltInDefaults()
    {
        var uniquePresetIds = new HashSet<string>(StringComparer.Ordinal);
        var uniquePresets = Configuration.DefaultPresets
            .Where(preset => uniquePresetIds.Add(preset.Id))
            .ToList();
        var changed = uniquePresets.Count != Configuration.DefaultPresets.Count;
        if (changed)
        {
            Configuration.DefaultPresets = uniquePresets;
        }

        foreach (var builtIn in PluginConfiguration.CreateBuiltInDefaultPresets())
        {
            if (Configuration.DefaultPresets.Any(preset =>
                    string.Equals(preset.Id, builtIn.Id, StringComparison.Ordinal)))
            {
                continue;
            }

            Configuration.DefaultPresets.Add(builtIn);
            changed = true;
        }

        return changed;
    }
}
