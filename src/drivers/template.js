/** This is a template file to create more drivers **/
class Driver {
  constructor() {
    this.query = this.query.bind(this);
    this.get = this.get.bind(this);
    this.update = this.update.bind(this);
    this.create = this.create.bind(this);
    this.delete = this.delete.bind(this);
    this.createTable = this.createTable.bind(this);
  }
  query(query) {
  }
  destroy() {
  }
  startTransaction() {
  }
  commit() {
  }
  rollback() {
  }
  get({table, search, where, offset, limit, order}) {
  }
  delete({table, where}) {
  }
  create({table, elements}) {
  }
  update({table, values, where}) {
  }
  createTable({table, data, index}) {
  }
}

module.exports = ({login, password, host}) => {
};
