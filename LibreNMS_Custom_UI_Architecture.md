# Enterprise NMS Architecture & Implementation Specification
**Core Backend Engine:** LibreNMS (Distributed)  
**Frontend Architecture:** Modern Headless Custom UI (React / Next.js)  
**Authentication & Authorization:** Unified SSO (OpenID Connect / OAuth2)

---

## 1. Executive Summary & System Overview

This document outlines the technical architecture for an enterprise-grade Network Management System (NMS). The architecture leverages **LibreNMS** as a headless data-collection, trap-handling, and metrics-processing backend engine while providing a high-performance, modern **Custom UI** tailored for operational network monitoring (routers, switches, P2P wireless backhauls).

To ensure unified administrative control and frictionless user experience between the native LibreNMS administration interface and the bespoke Custom UI, a centralized **Single Sign-On (SSO)** architecture is implemented using OpenID Connect (OIDC) / OAuth2 via an Identity Provider (Keycloak / Authelia / Okta).

```
                             +-------------------------------+
                             |  Identity Provider (IdP)      |
                             |  (Keycloak / OAuth2 / OIDC)   |
                             +---------------+---------------+
                                             |
                   +-------------------------+-------------------------+
                   | OIDC Authentication                               | OIDC Authentication
                   v                                                   v
     +---------------------------+                       +---------------------------+
     |   Custom Frontend UI      |                       |    LibreNMS Native UI    |
     | (React / Next.js / Vue)   |                       |   (Laravel / Blade Engine)|
     +-------------+-------------+                       +-------------+-------------+
                   |                                                   |
                   | REST API / WebSockets                             | Direct DB / Core
                   +-------------------------+-------------------------+
                                             |
                                             v
                                 +-----------------------+
                                 |  LibreNMS Engine      |
                                 |  (REST API & Backend) |
                                 +-----------+-----------+
                                             |
                   +-------------------------+-------------------------+
                   |                                                   |
                   v                                                   v
     +---------------------------+                       +---------------------------+
     |   Poller Cluster          |                       |   Time-Series & DB        |
     | (Redis Queue Workers)     |                       | (MariaDB + RRDCached)     |
     +---------------------------+                       +---------------------------+
```

---

## 2. High-Level System Architecture

### 2.1 Backend Engine (LibreNMS Core)
* **Role:** Device discovery, SNMP v1/v2c/v3 polling, Syslog/Trap ingestion, alarm rule processing, and metrics generation.
* **Storage Layer:** 
  * **MariaDB:** Configuration storage, device inventories, interface indices, alert logs.
  * **RRDCached / InfluxDB:** High-throughput time-series metrics (interface throughput, P2P RSSI/SNR, CPU, latency).
* **Distributed Poller Farm:** Scalable Redis-backed worker pool capable of handling >5,000 devices across distributed remote sites.

### 2.2 Custom Frontend UI
* **Framework:** React / Next.js or Vue.js with Tailwind CSS.
* **Visualization Engine:** Apache ECharts or Recharts for high-density network graphs.
* **Communication Pipelines:**
  * **LibreNMS REST API:** Device lists, port details, alert management, and system metadata.
  * **WebSockets / InfluxDB Direct Query:** Real-time stream processing for high-frequency telemetry (e.g., P2P wireless link degradation, instant link status changes).

### 2.3 Native LibreNMS UI
* Kept accessible for administrator deep-dives, custom MIB definitions, advanced threshold editing, and native system configuration.

---

## 3. Single Sign-On (SSO) Architecture

To achieve seamless single sign-on between the **Custom UI** and the **LibreNMS Native UI**, both applications delegate authentication to a centralized OIDC/OAuth2 Identity Provider (IdP).

### 3.1 Authentication Sequence Flow

```
+-----------+            +-----------+            +---------------+            +---------------+
|   User    |            | Custom UI |            | LibreNMS Native|            | Identity Prov.|
+-----+-----+            +-----+-----+            +-------+-------+            +-------+-------+
      |                        |                          |                            |
      | 1. Access Custom UI    |                          |                            |
      |----------------------->|                          |                            |
      |                        | 2. Redirect to IdP       |                            |
      |                        |------------------------------------------------------>|
      | 3. Authenticate        |                          |                            |
      |<--------------------------------------------------------------------------------|
      | 4. Issue ID & Access Tokens                       |                            |
      |-------------------------------------------------->|                            |
      |                        | 5. Token Validated       |                            |
      |                        |<------------------------------------------------------|
      | 6. Authenticated Session                          |                            |
      |<-----------------------|                          |                            |
      |                                                   |                            |
      | 7. Switch to Native LibreNMS UI                   |                            |
      |-------------------------------------------------->|                            |
      |                                                   | 8. Check SSO Session       |
      |                                                   |--------------------------->|
      |                                                   | 9. Active Session Confirmed|
      |                                                   |<---------------------------|
      | 10. Auto-Logged In (No Credentials Prompt)        |                            |
      |<--------------------------------------------------|                            |
```

### 3.2 SSO Protocol Configurations

#### Identity Provider (IdP) Requirements
* **Protocol:** OpenID Connect (OIDC) / OAuth2.
* **Tokens Issued:** JWT Access Token, ID Token, Refresh Token.
* **Shared Cookie Domain:** `.yourdomain.com` (enables cross-subdomain session verification if host-based cookie sharing is used).

#### Custom UI Configuration
* Implements standard OIDC PKCE Authorization Code Flow.
* Stores short-lived access tokens in memory/secure HTTP-only cookies.
* Passes `Authorization: Bearer <token>` on all requests to API proxies or backend services.

#### LibreNMS Native UI Configuration
* LibreNMS supports Socialite-based SSO authentication out of the box (SAML2, OpenID Connect, OAuth2).
* Enabled by configuring OIDC parameters in `config/services.php` or through `/opt/librenms/config.php`.

---

## 4. Technical Implementation & Configuration

### 4.1 LibreNMS OIDC SSO Setup (`config.php`)

Add the following OIDC configuration to your LibreNMS installation to enable SSO integration:

```php
// /opt/librenms/config.php

// Enable Custom OIDC / SSO Authentication
$config['auth_mechanism'] = 'sso';

// SSO Provisioning & Security Options
$config['sso']['mode'] = 'openid';
$config['sso']['header'] = 'HTTP_X_AUTH_USER';
$config['sso']['create_users'] = true;
$config['sso']['update_users'] = true;
$config['sso']['default_level'] = 1; // 1 = Normal User, 10 = Administrator

// OAuth2 / OIDC Client Settings
$config['auth_oidc_client_id'] = 'librenms-native-client';
$config['auth_oidc_client_secret'] = 'YOUR_SECURE_CLIENT_SECRET';
$config['auth_oidc_idp_url'] = 'https://sso.yourdomain.com/realms/master';
$config['auth_oidc_scopes'] = ['openid', 'profile', 'email', 'roles'];
```

### 4.2 Custom UI OIDC Integration (React / Next.js Example)

In your Custom UI application, initialize an OIDC user manager:

```javascript
// src/auth/authConfig.js
import { UserManager } from 'oidc-client-ts';

export const oidcConfig = {
  authority: "https://sso.yourdomain.com/realms/master",
  client_id: "nms-custom-ui",
  redirect_uri: "https://nms.yourdomain.com/callback",
  response_type: "code",
  scope: "openid profile email network-api",
  post_logout_redirect_uri: "https://nms.yourdomain.com",
  automaticSilentRenew: true,
};

export const userManager = new UserManager(oidcConfig);
```

### 4.3 Custom UI API Proxy & LibreNMS Integration

To allow the Custom UI to fetch metrics and data securely from LibreNMS using the user's SSO identity, configure an API Gateway (or Nginx Reverse Proxy) to convert the user's SSO token into an authorized API call:

```nginx
# /etc/nginx/sites-available/nms-gateway.conf

server {
    listen 443 ssl http2;
    server_name nms.yourdomain.com;

    ssl_certificate /etc/ssl/certs/nms.crt;
    ssl_certificate_key /etc/ssl/certs/nms.key;

    # Custom UI Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # LibreNMS Native UI (Seamless Cross-Navigation)
    location /native/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy Custom UI REST requests to LibreNMS API
    location /api/v0/ {
        proxy_pass http://127.0.0.1:8000/api/v0/;
        proxy_set_header Host $host;
        # Inject API Token or map user session token
        proxy_set_header X-Auth-Token "YOUR_LIBRENMS_GLOBAL_API_TOKEN";
    }
}
```

---

## 5. UI/UX Feature Specification for Custom Frontend

The Custom UI should focus on high-priority operational workflows, leaving general administration to the native interface.

### 5.1 Dashboard Components
1. **P2P Link Performance Matrix:**
   * Signal-to-Noise Ratio (SNR) and Received Signal Strength Indicator (RSSI) live indicators.
   * Mod-rate stability charts and frequency utilization metrics.
2. **Router & Switch Infrastructure Overview:**
   * Interface state indicators (Up/Down/Flapping).
   * Top 10 interfaces by bandwidth usage (95th percentile calculations).
   * CPU / Memory heatmap across core network switches.
3. **Unified Alarm Console:**
   * Real-time alert feed filtered by device type (Routers, Switches, Microwave P2P).
   * One-click acknowledgment button (synced via LibreNMS API).

### 5.2 Navigation & Cross-UI Links
* A persistent top-bar action button labeled **"Open Admin Portal"** in the Custom UI that links directly to `/native/` (the native LibreNMS UI).
* Because both applications share the OIDC Identity Provider session, clicking this link transitions the user immediately without re-entering credentials.

---

## 6. Scaling Strategy for >5,000 Devices

To ensure both the Custom UI and backend perform reliably at scale:

1. **Decouple Metrics Storage:** Configure LibreNMS to write metrics directly to **InfluxDB** or **TimescaleDB** in addition to RRD. Have the Custom UI read graph telemetry straight from InfluxDB for ultra-low latency dashboard loads.
2. **Redis Message Queue:** Deploy a Redis cluster to balance poller tasks across multiple LibreNMS poller worker nodes.
3. **API Caching Layer:** Implement a Redis-backed caching layer in the API Gateway for static topology and inventory endpoints (`/api/v0/devices`) to prevent database strain from multi-user Custom UI rendering.
