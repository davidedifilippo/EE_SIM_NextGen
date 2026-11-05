// Termometro: l'uscita di un LM35 su A0, 10 mV per grado; la temperatura sul monitor seriale.
const int SENSORE = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  float volt = analogRead(SENSORE) * 5.0 / 1023.0;
  float gradi = volt * 100.0;
  Serial.print("Temperatura: ");
  Serial.print(gradi, 1);
  Serial.println(" C");
  delay(500);
}
