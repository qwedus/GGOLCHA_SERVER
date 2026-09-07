#include <time.h>

#include "main.h"

#include "driver/i2c_master.h"
#include "esp_http_server.h"
#include "esp_netif_sntp.h"
#include "esp_wifi.h"

#define WIFI_FAIL_BIT (1 << 0)
#define WIFI_CONNECTED_BIT (1 << 1)

httpd_handle_t webserver(void);

static EventGroupHandle_t wifi_evt;

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  }

  else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
    if (IS_OK(&logbuf.run, WIFI)) {
      char buf[sizeof(system_event_t)];
      snprintf(buf, sizeof(buf), "STA_LOST:%02X", ((wifi_event_sta_disconnected_t *)event_data)->reason);
      ERROR_SYSLOG(&logbuf.run, WIFI, buf, buf);
    }
    esp_wifi_connect();
  }

  else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
    xEventGroupSetBits(wifi_evt, WIFI_CONNECTED_BIT);
    CLEAR_ALL(&logbuf.run, WIFI);

    if (mqtt != NULL && IS_ERROR(&logbuf.run, MQTT)) {
      esp_mqtt_client_reconnect(mqtt);
    }

    SYSLOG("WIFI_CONN");
    INFO(WIFI, "connected to %s(" IPSTR ")", storage.wifi.ssid, IP2STR(&((ip_event_got_ip_t *)event_data)->ip_info.ip));
  }
}

static void sntp_sync_callback(struct timeval *tv) {
  i2c_master_bus_handle_t i2c0;

  // i2c0 already initalized
  if (i2c_master_get_bus_handle(I2C_NUM_0, &i2c0) != ESP_OK) {
    ERROR_SYSLOG(&logbuf.run, RTC, "I2C get bus failure", "RTC_I2C_FAIL");
    return;
  }

  i2c_master_dev_handle_t rtc;
  i2c_device_config_t rtc_cfg = {
    .dev_addr_length = I2C_ADDR_BIT_LEN_7,
    .device_address  = 0x51,
    .scl_speed_hz    = 100000,
  };

  if (i2c_master_bus_add_device(i2c0, &rtc_cfg, &rtc) != ESP_OK) {
    ERROR_SYSLOG(&logbuf.run, RTC, "device init failure", "RTC_DEV_FAIL");
    return;
  }

  struct tm tp;
  struct tm *tm = gmtime_r(&tv->tv_sec, &tp);

  uint8_t tx[8];
  tx[0] = 0x02;                           // VL_seconds register address
  tx[1] = DEC_TO_BCD(tm->tm_sec);         // seconds
  tx[2] = DEC_TO_BCD(tm->tm_min);         // minutes
  tx[3] = DEC_TO_BCD(tm->tm_hour);        // hours
  tx[4] = DEC_TO_BCD(tm->tm_mday);        // day of month
  tx[5] = DEC_TO_BCD(tm->tm_wday);        // day of week
  tx[6] = DEC_TO_BCD(tm->tm_mon + 1);     // month
  tx[7] = DEC_TO_BCD(tm->tm_year - 100);  // year

  esp_err_t ret;
  int cnt = 0;

  do {
    ret = i2c_master_transmit(rtc, tx, sizeof(tx), I2C_TIMEOUT_MS);
    if (ret != ESP_OK) i2c_master_bus_reset(i2c0);
    cnt++;
  } while (ret != ESP_OK && cnt < 3);

  if (ret != ESP_OK) {
    ERROR_SYSLOG(&logbuf.run, RTC, "write time transfer failure", "RTC_WRITE_FAIL");
  } else {
    SYSLOG("RTC_SNTP_SYNC");
  }

  i2c_master_bus_rm_device(rtc);
  INFO(RTC, "SNTP time set to %s", ctime(&tv->tv_sec));
}

bool network_init(void) {
  if (esp_netif_init() != ESP_OK || esp_event_loop_create_default() != ESP_OK) {
    ERROR_SYSLOG(&init, WIFI, "netif init failure", "NETIF_INIT_FAIL");
    return false;
  }

  esp_netif_create_default_wifi_ap();
  esp_netif_create_default_wifi_sta();

  wifi_init_config_t wifi_cfg = WIFI_INIT_CONFIG_DEFAULT();
  if (esp_wifi_init(&wifi_cfg) != ESP_OK) {
    ERROR_SYSLOG(&init, WIFI, "init failure", "WIFI_INIT_FAIL");
    return false;
  }

  wifi_evt = xEventGroupCreate();

  esp_event_handler_instance_t instance_any_id;
  esp_event_handler_instance_t instance_got_ip;
  esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, &instance_any_id);
  esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, &instance_got_ip);

  // ---- AP: 상시 on. SSID/PW 저장 여부와 무관하게 항상 켠다 ----
  wifi_config_t ap = {
    .ap = {
      .password       = "monolith",
      .max_connection = 4,
      .authmode       = WIFI_AUTH_WPA2_PSK,
    },
  };
  snprintf((char *)ap.ap.ssid, sizeof(ap.ap.ssid), "Monolith v2 %02X%02X%02X",
    storage.wifi.mac[3], storage.wifi.mac[4], storage.wifi.mac[5]);

  esp_wifi_set_mode(WIFI_MODE_APSTA);
  esp_wifi_set_config(WIFI_IF_AP, &ap);

  // ---- STA: 저장된 자격증명이 있을 때만 설정. 없으면 그냥 붙는 시도를 안 함 ----
  bool have_creds = strlen(storage.wifi.ssid) > 0 && strlen(storage.wifi.passwd) >= 8;

  if (have_creds) {
    wifi_config_t sta = { 0 };
    snprintf((char *)sta.sta.ssid, sizeof(sta.sta.ssid), "%s", storage.wifi.ssid);
    snprintf((char *)sta.sta.password, sizeof(sta.sta.password), "%s", storage.wifi.passwd);
    sta.sta.scan_method        = WIFI_FAST_SCAN;
    sta.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    esp_wifi_set_config(WIFI_IF_STA, &sta);
  }

  if (esp_wifi_start() != ESP_OK) {
    ERROR_SYSLOG(&init, WIFI, "start failure", "WIFI_START_FAIL");
    return false;
  }

  // 포털 HTTP 서버 + 캡티브 DNS는 언제나 띄운다 (webserver.c)
  ap_start();

  // SNTP는 STA가 실제로 붙었을 때(IP_EVENT_STA_GOT_IP)만 의미 있으므로 그대로 이벤트
  // 핸들러 쪽에서 처리 (아래 wifi_event_handler 참고). app_main()을 더 이상 여기서
  // 블록하지 않고 바로 리턴 — STA 연결 여부와 무관하게 MQTT 초기화로 넘어간다.
  SYSLOG("WIFI_INIT_DONE");
  return true;
}
