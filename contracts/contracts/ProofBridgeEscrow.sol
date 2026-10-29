// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract ProofBridgeEscrow is Ownable, ReentrancyGuard {
    struct Escrow {
        address buyer;
        address payable seller;
        uint256 amount;
        string shipmentId;
        bool released;
    }

    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => bool) public usedNonces;
    address public authorizedSigner;
    uint64 public constant MAX_CLOCK_SKEW = 60;

    event EscrowCreated(bytes32 indexed escrowId, address indexed buyer, address indexed seller, uint256 amount, string shipmentId);
    event AttestationAccepted(bytes32 indexed escrowId, bytes32 indexed evidenceHash, bytes32 indexed nonce);
    event EscrowReleased(bytes32 indexed escrowId, address indexed seller, uint256 amount);
    event AttestationRejected(bytes32 indexed escrowId, uint8 reasonCode);
    event AuthorizedSignerUpdated(address indexed previousSigner, address indexed newSigner);

    constructor(address initialSigner) Ownable(msg.sender) {
        require(initialSigner != address(0), "invalid signer");
        authorizedSigner = initialSigner;
    }

    function createEscrow(bytes32 escrowId, string calldata shipmentId, address payable seller) external payable {
        require(escrowId != bytes32(0), "invalid escrow id");
        require(escrows[escrowId].buyer == address(0), "escrow exists");
        require(seller != address(0) && seller != msg.sender, "invalid seller");
        require(msg.value > 0, "deposit required");
        require(bytes(shipmentId).length > 0 && bytes(shipmentId).length <= 64, "invalid shipment id");

        escrows[escrowId] = Escrow(msg.sender, seller, msg.value, shipmentId, false);
        emit EscrowCreated(escrowId, msg.sender, seller, msg.value, shipmentId);
    }

    function setAuthorizedSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "invalid signer");
        emit AuthorizedSignerUpdated(authorizedSigner, newSigner);
        authorizedSigner = newSigner;
    }

    function release(
        bytes32 escrowId,
        bytes32 schemaVersion,
        bytes32 attestationId,
        bytes32 evidenceHash,
        bytes32 sourceId,
        uint64 issuedAt,
        uint64 expiresAt,
        bytes32 nonce,
        uint8 outcome,
        bytes calldata signature
    ) external nonReentrant returns (bool) {
        Escrow storage escrow = escrows[escrowId];
        if (escrow.buyer == address(0)) return _reject(escrowId, 0);
        if (escrow.released) return _reject(escrowId, 1);
        if (outcome != 1) return _reject(escrowId, 2);
        if (block.timestamp >= expiresAt) return _reject(escrowId, 3);
        if (issuedAt > block.timestamp + MAX_CLOCK_SKEW || expiresAt <= issuedAt || expiresAt - issuedAt > 1 days) return _reject(escrowId, 4);
        if (usedNonces[nonce]) return _reject(escrowId, 5);

        bytes32 digest = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                schemaVersion,
                attestationId,
                escrowId,
                keccak256(bytes(escrow.shipmentId)),
                evidenceHash,
                sourceId,
                issuedAt,
                expiresAt,
                nonce,
                outcome
            )
        );
        (address recovered, ECDSA.RecoverError errorCode,) = ECDSA.tryRecover(
            MessageHashUtils.toEthSignedMessageHash(digest), signature
        );
        if (errorCode != ECDSA.RecoverError.NoError || recovered != authorizedSigner) return _reject(escrowId, 6);

        usedNonces[nonce] = true;
        escrow.released = true;
        emit AttestationAccepted(escrowId, evidenceHash, nonce);
        emit EscrowReleased(escrowId, escrow.seller, escrow.amount);
        (bool success,) = escrow.seller.call{value: escrow.amount}("");
        require(success, "transfer failed");
        return true;
    }

    function _reject(bytes32 escrowId, uint8 reasonCode) private returns (bool) {
        emit AttestationRejected(escrowId, reasonCode);
        return false;
    }
}