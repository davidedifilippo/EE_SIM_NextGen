// Blink: il LED L della scheda (D13) e un LED esterno su D12 si accendono e si spengono ogni secondo.
const int LED_ESTERNO = 12;

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(LED_ESTERNO, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  digitalWrite(LED_ESTERNO, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  digitalWrite(LED_ESTERNO, LOW);
  delay(1000);
}
