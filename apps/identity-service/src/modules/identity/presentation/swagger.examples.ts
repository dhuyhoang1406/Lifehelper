export const authSwaggerExamples = {
  register: {
    email: "swagger-test@example.com",
    password: "ExamplePass123",
    displayName: "Swagger Tester",
    device: { deviceId: "swagger-browser", platform: "WEB", deviceName: "Browser" },
  },
  login: {
    email: "swagger-test@example.com",
    password: "ExamplePass123",
    device: { deviceId: "swagger-browser", platform: "WEB", deviceName: "Browser" },
  },
  refresh: { refreshToken: "<refreshToken from register or login response>" },
  google: {
    idToken: "<valid Google ID token>",
    device: { deviceId: "swagger-browser", platform: "WEB", deviceName: "Browser" },
  },
} as const;
