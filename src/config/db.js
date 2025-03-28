const { Sequelize } = require("sequelize");

// Configura la conexión a la base de datos
const sequelize = new Sequelize("tepaseo", "root", "Root", {
  host: "localhost",
  dialect: "mysql",
  timezone: "-03:00", // Zona horaria de Uruguay (GMT -0300)
  dialectOptions: {
    timezone: "-03:00", // Ajuste adicional de zona horaria si es necesario
  },
  logging: false,
});


module.exports = sequelize;
