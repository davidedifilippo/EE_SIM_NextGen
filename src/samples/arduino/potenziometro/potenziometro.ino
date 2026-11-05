// Potenziometro e PWM: la tensione del cursore su A0 regola la luminosità del LED su D9.
const int CURSORE = A0;
const int LED = 9;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int lettura = analogRead(CURSORE);   // da 0 a 1023
  analogWrite(LED, lettura / 4);       // da 0 a 255
  Serial.print("A0 = ");
  Serial.print(lettura);
  Serial.print("  PWM = ");
  Serial.println(lettura / 4);
  delay(200);
}
