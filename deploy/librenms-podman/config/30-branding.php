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
