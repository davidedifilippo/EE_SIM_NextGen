// Pulsante: un pulsante tra D2 e massa, con il pull-up interno; il LED su D12 resta acceso finché è premuto.
const int PULSANTE = 2;
const int LED = 12;

void setup() {
  pinMode(PULSANTE, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  // Premuto, il pulsante porta D2 a massa: si legge LOW
  digitalWrite(LED, digitalRead(PULSANTE) == LOW ? HIGH : LOW);
}
