<?php
// 30-branding.php - native-UI rebrand to "AIRNMS" (deployment-findings: Native-UI
// branding, config-only, FR-07-compliant). Config-only, additive; NO core/blade/template edit.
// Keys verified against LibreNMS 25.7.0 config_definitions.json (project_name @6180,
// page_title_suffix @5698, title_image @6903). Human-provided AIRNMS logo staged.
$config['project_name'] = 'AIRNMS';
$config['page_title_suffix'] = 'AIRNMS';
// title_image: staged AIRNMS navbar logo (340x64 PNG) served from html/images/custom/ via a
// quadlet bind-mount. <x-logo> then renders <img src alt=project_name>, replacing the drawn
// LibreNMS SVG glyph (@else branch). html/images/custom/ is a docs-sanctioned custom dir
// (auto-update-safe per doc/Support/Configuration.md), NOT a core source/blade dir -> FR-07-safe.
$config['title_image'] = 'images/custom/airnms_logo.png';
// favicon: staged AIRNMS favicon (.ico, 16/32/48) served from html/images/custom/ via the same
// bind-mount. VALUE-SHAPE (verified against LibreNMS 25.7.0 source):
//   resources/views/layouts/librenmsv1.blade.php:18 renders the favicon VERBATIM into the href —
//     <link rel="shortcut icon" href="{{ LibrenmsConfig::get('favicon') }}">
//   It is NOT wrapped in Laravel's asset() helper (unlike title_image, install.blade.php:98), so it
//   receives NO web-root prefix. The page carries <base href="{{ base_url }}">, so a *relative* value
//   would resolve against the current page path (404 on deep routes like /device/7/...). We therefore
//   use a ROOT-RELATIVE path (leading '/'): a leading-slash href ignores <base> and resolves from the
//   origin root, where asset('images/custom/…') also serves the file. Native UI is at the gateway root.
//   config_definitions.json favicon: {"default":"","group":"webui","section":"style","type":"text"}.
$config['favicon'] = '/images/custom/airnms_favicon.ico';
